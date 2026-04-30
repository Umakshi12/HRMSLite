import { google } from 'googleapis';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// Primary spreadsheet ID from env (the "master" spreadsheet that holds users, config, etc.)
const PRIMARY_SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH;

let auth;
let sheetsClient;

const quoteSheetName = (sheetName) => {
  const name = String(sheetName || '').trim();
  if (!name) return name;
  if (name.startsWith("'") && name.endsWith("'")) return name;
  return `'${name.replace(/'/g, "''")}'`;
};

const normalizeRange = (range) => {
  const value = String(range || '').trim();
  if (!value.includes('!')) return value;
  const [sheetName, a1Range] = value.split('!');
  if (!a1Range) return quoteSheetName(sheetName);
  return `${quoteSheetName(sheetName)}!${a1Range}`;
};

const initSheets = async () => {
  if (sheetsClient) return sheetsClient;

  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (clientEmail && privateKey) {
    auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else if (credentialsJson) {
    auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(credentialsJson),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      throw new Error(`Google Credentials missing. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY, or GOOGLE_CREDENTIALS_JSON, or provide file at ${CREDENTIALS_PATH}`);
    }
    auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  const client = await auth.getClient();
  sheetsClient = google.sheets({ version: 'v4', auth: client });
  return sheetsClient;
};

// Helper to resolve spreadsheet ID - falls back to primary
const resolveId = (spreadsheetId) => spreadsheetId || PRIMARY_SPREADSHEET_ID;

export const ensureSheetExists = async (sheetName, headers, spreadsheetId) => {
  const service = await initSheets();
  const ssId = resolveId(spreadsheetId);
  const metadata = await service.spreadsheets.get({ spreadsheetId: ssId });
  const sheetExists = metadata.data.sheets.some(s => s.properties.title === sheetName);

  if (!sheetExists) {
    console.log(`Creating missing sheet: ${sheetName}`);
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

// Global queue for rate limiting
let apiQueue = Promise.resolve();
const queueRequest = (fn) => {
  const p = apiQueue.then(async () => {
    await new Promise(resolve => setTimeout(resolve, 250));
    return fn();
  });
  apiQueue = p.catch(() => {}); // Continue queue even on error
  return p;
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

export const appendRow = async (range, values, spreadsheetId) => {
  return queueRequest(async () => {
    const service = await initSheets();
    await service.spreadsheets.values.append({
      spreadsheetId: resolveId(spreadsheetId),
      range: normalizeRange(range),
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] },
    });
  });
};

export const appendRows = async (range, rows, spreadsheetId) => {
  return queueRequest(async () => {
    const service = await initSheets();
    await service.spreadsheets.values.append({
      spreadsheetId: resolveId(spreadsheetId),
      range: normalizeRange(range),
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
  });
};

export const updateFullSheet = async (sheetName, rows, spreadsheetId) => {
  return queueRequest(async () => {
    const service = await initSheets();
    const ssId = resolveId(spreadsheetId);
    const range = `${quoteSheetName(sheetName)}!A:Z`;
    
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
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows },
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
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] },
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
  const rows = await getSheetData(`${quoteSheetName(sheetName)}!A:Z`, spreadsheetId);
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
  const rows = await getSheetData(`${quoteSheetName(sheetName)}!A:Z`, spreadsheetId);
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
