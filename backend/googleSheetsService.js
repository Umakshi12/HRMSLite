import { google } from 'googleapis';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// Primary spreadsheet ID from env (the "master" spreadsheet that holds users, config, etc.)
const PRIMARY_SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH;

// SECURITY: Removed module-level singletons to prevent data isolation bugs in concurrent load
const clientCache = new Map(); // Per-owner auth cache to prevent Google token rate limits

// SECURITY: Prevent Formula Injection (CSV Injection)
// Values starting with =, +, -, or @ can be interpreted as formulas in Google Sheets
const sanitizeValue = (val) => {
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  if (trimmed.startsWith('=') || trimmed.startsWith('+') || trimmed.startsWith('-') || trimmed.startsWith('@')) {
    return `'${val}`; // Prepend single quote to escape as text
  }
  return val;
};

const sanitizeValues = (values) => {
  if (!Array.isArray(values)) return values;
  return values.map(v => Array.isArray(v) ? v.map(sanitizeValue) : sanitizeValue(v));
};

const quoteSheetName = (sheetName) => {
  const name = String(sheetName || '');
  if (!name) return name;
  if (/[\n\r\t]/.test(name)) throw new Error(`Invalid sheet name contains control characters: ${JSON.stringify(name)}`);
  if (name.startsWith("'") && name.endsWith("'")) return name;
  // Only quote if the name contains spaces or special characters
  if (/[\s!'"()]/.test(name)) return `'${name.replace(/'/g, "''")}'`;
  return name;
};

const normalizeRange = (range) => {
  const value = String(range || '').trim();
  if (!value.includes('!')) return value;
  const [sheetName, a1Range] = value.split('!');
  if (!a1Range) return quoteSheetName(sheetName);
  return `${quoteSheetName(sheetName)}!${a1Range}`;
};

import { getAuthorizedClient } from './googleAuthService.js';

const initSheets = async (ownerLoginId = null) => {
  const cacheKey = ownerLoginId || 'service-account';
  if (clientCache.has(cacheKey)) return clientCache.get(cacheKey);

  // If ownerLoginId is provided, try to get their personal OAuth client first
  if (ownerLoginId) {
    try {
      const oauthClient = await getAuthorizedClient(ownerLoginId);
      if (oauthClient) {
        clientCache.set(cacheKey, oauthClient);
        return oauthClient;
      }
    } catch (err) {
      console.warn(`[Google Sheets] Failed to get OAuth client for ${ownerLoginId}, falling back to service account:`, err.message);
    }
  }

  let localAuth;
  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (clientEmail && privateKey) {
    localAuth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else if (credentialsJson) {
    localAuth = new google.auth.GoogleAuth({
      credentials: JSON.parse(credentialsJson),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      throw new Error(`Google Credentials missing. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY, or GOOGLE_CREDENTIALS_JSON, or provide file at ${CREDENTIALS_PATH}`);
    }
    localAuth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  const client = await localAuth.getClient();
  const service = google.sheets({ version: 'v4', auth: client });
  clientCache.set(cacheKey, service);
  return service;
};

// Helper to resolve spreadsheet ID - falls back to primary
const resolveId = (spreadsheetId) => {
  const id = spreadsheetId || PRIMARY_SPREADSHEET_ID;
  if (!id) throw new Error('Spreadsheet ID is missing. Ensure SPREADSHEET_ID is set in .env or passed to the function.');
  return id;
};

export const ensureSheetExists = async (sheetName, headers, spreadsheetId) => {
  const service = await initSheets();
  const ssId = resolveId(spreadsheetId);
  const metadata = await service.spreadsheets.get({ spreadsheetId: ssId });
  const sheetExists = metadata.data.sheets.some(s => s.properties.title === sheetName);

  if (!sheetExists) {
    console.log(`Creating missing sheet: ${sheetName}`);
    await queueRequest(async () => {
      await service.spreadsheets.batchUpdate({
        spreadsheetId: ssId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: sheetName } } }]
        }
      });
      await service.spreadsheets.values.update({
        spreadsheetId: ssId,
        range: `${sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [headers] }
      });
    });
  }
};

export const getSheetNames = async (spreadsheetId) => {
  return queueRequest(async () => {
    const service = await initSheets();
    const metadata = await service.spreadsheets.get({ spreadsheetId: resolveId(spreadsheetId) });
    return (metadata.data.sheets || [])
      .map((s) => s?.properties?.title)
      .filter(Boolean);
  });
};

export const getSpreadsheetTitle = async (spreadsheetId) => {
  return queueRequest(async () => {
    const service = await initSheets();
    const metadata = await service.spreadsheets.get({ spreadsheetId: resolveId(spreadsheetId) });
    return metadata.data.properties?.title || 'Untitled';
  });
};

export const getSpreadsheetMetadata = async (spreadsheetId) => {
  return queueRequest(async () => {
    const service = await initSheets();
    const metadata = await service.spreadsheets.get({ spreadsheetId: resolveId(spreadsheetId) });
    return metadata.data;
  });
};

// Global queue and retry logic for Google API resilience
const MAX_RETRIES = 3;
const INITIAL_BACKOFF = 1000; // 1 second

const queueRequest = async (fn) => {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Logic: Only wait on retries, not on the first successful call
      if (attempt > 0) {
        const delay = INITIAL_BACKOFF * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      
      // Retry on 429 (Rate Limit) or 5xx (Server Error)
      if (status === 429 || (status >= 500 && status <= 599)) {
        console.warn(`[Google Sheets] API Error ${status}. Attempting retry ${attempt + 1}/${MAX_RETRIES}...`);
        continue;
      }
      throw err; // Permanent error (401, 403, 404), don't retry
    }
  }
  throw lastError;
};

export const getSheetData = async (range, spreadsheetId) => {
  return queueRequest(async () => {
    const service = await initSheets();
    const response = await service.spreadsheets.values.get({
      spreadsheetId: resolveId(spreadsheetId),
      range: normalizeRange(range),
    });
    return response.data.values || [];
  });
};

export const columnToLetter = (col) => {
  let letter = '';
  while (col > 0) {
    const rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
};

export const getSheetDataFull = async (sheetName, spreadsheetId, cachedHeaders = null) => {
  const colCount = cachedHeaders 
    ? (cachedHeaders.length + 5)
    : (await getSheetData(`${quoteSheetName(sheetName)}!A1:ZZ1`, spreadsheetId))[0]?.length + 5 || 52;
  const lastCol = columnToLetter(Math.max(colCount, 52));
  return getSheetData(`${quoteSheetName(sheetName)}!A:${lastCol}`, spreadsheetId);
};

export const appendRow = async (range, values, spreadsheetId) => {
  return queueRequest(async () => {
    const service = await initSheets();
    await service.spreadsheets.values.append({
      spreadsheetId: resolveId(spreadsheetId),
      range: normalizeRange(range),
      valueInputOption: 'RAW', // Use RAW for data writes to neutralize formula injection
      requestBody: { values: [sanitizeValues(values)] },
    });
  });
};

export const appendRows = async (range, rows, spreadsheetId) => {
  return queueRequest(async () => {
    const service = await initSheets();
    await service.spreadsheets.values.append({
      spreadsheetId: resolveId(spreadsheetId),
      range: normalizeRange(range),
      valueInputOption: 'RAW',
      requestBody: { values: sanitizeValues(rows) },
    });
  });
};

export const updateFullSheet = async (sheetName, rows, spreadsheetId) => {
  return queueRequest(async () => {
    const service = await initSheets();
    const ssId = resolveId(spreadsheetId);
    const range = `${quoteSheetName(sheetName)}!A:ZZ`;
    
    // Clear existing content
    await service.spreadsheets.values.clear({
      spreadsheetId: ssId,
      range: normalizeRange(range),
    });

    // Update with new content
    if (rows && rows.length > 0) {
      await service.spreadsheets.values.update({
        spreadsheetId: ssId,
        range: `${quoteSheetName(sheetName)}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: sanitizeValues(rows) },
      });
    }
  });
};

export const updateRow = async (sheetName, rowIndex, values, spreadsheetId) => {
  return queueRequest(async () => {
    const service = await initSheets();
    const ssId = resolveId(spreadsheetId);
    const range = `${quoteSheetName(sheetName)}!A${rowIndex + 1}`;
    await service.spreadsheets.values.update({
      spreadsheetId: ssId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [sanitizeValues(values)] },
    });
  });
};

export const deleteRow = async (sheetName, rowIndex, spreadsheetId) => {
  return queueRequest(async () => {
    const service = await initSheets();
    const ssId = resolveId(spreadsheetId);
    const metadata = await service.spreadsheets.get({ spreadsheetId: ssId });
    const sheet = metadata.data.sheets.find(s => s.properties.title === sheetName);

    if (!sheet) throw new Error(`Sheet ${sheetName} not found`);

    await service.spreadsheets.batchUpdate({
      spreadsheetId: ssId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: sheet.properties.sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex,
              endIndex: rowIndex + 1
            }
          }
        }]
      }
    });
  });
};

export const findRowIndex = async (sheetName, columnName, value, spreadsheetId) => {
  const rows = await getSheetDataFull(sheetName, spreadsheetId);
  if (!rows.length) return -1;

  const headers = rows[0];
  const colIndex = headers.indexOf(columnName);
  if (colIndex === -1) return -1;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][colIndex] === value) return i;
  }
  return -1;
};

export const findRowIndexByAliases = async (sheetName, aliases, value, spreadsheetId) => {
  const rows = await getSheetDataFull(sheetName, spreadsheetId);
  if (!rows.length) return -1;
  const headers = rows[0].map((h) => String(h).trim());
  const normalizedAliases = aliases.map((a) => String(a).toLowerCase().replace(/[^a-z0-9]+/g, ''));
  const colIndex = headers.findIndex((h) => normalizedAliases.includes(String(h).toLowerCase().replace(/[^a-z0-9]+/g, '')));
  if (colIndex === -1) return -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][colIndex]) === String(value)) return i;
  }
  return -1;
};

// Map row array to object based on headers
export const rowsToObjects = (rows) => {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1)
    .filter(row => row.some(cell => String(cell || '').trim() !== '')) // Skip empty rows
    .map((row) => {
      const obj = {};
      headers.forEach((header, i) => {
        const normalizedHeader = String(header || `col_${i + 1}`)
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '') || `col_${i + 1}`;
        obj[normalizedHeader] = row[i] || '';
      });
      return obj;
    });
};

export { PRIMARY_SPREADSHEET_ID };
