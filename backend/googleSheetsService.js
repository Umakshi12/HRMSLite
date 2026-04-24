import { google } from 'googleapis';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH;

let auth;
let sheets;

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
  if (sheets) return sheets;

  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
  
  if (credentialsJson) {
    // If credentials are provided as a JSON string in the environment variables (e.g. Vercel/Render)
    auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(credentialsJson),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else {
    // Fallback to local file path (e.g. local development)
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      throw new Error(`Google Credentials missing. Set GOOGLE_CREDENTIALS_JSON env var or provide file at ${CREDENTIALS_PATH}`);
    }
    auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  const client = await auth.getClient();
  sheets = google.sheets({ version: 'v4', auth: client });
  return sheets;
};

export const ensureSheetExists = async (sheetName, headers) => {
  const service = await initSheets();
  const metadata = await service.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetExists = metadata.data.sheets.some(s => s.properties.title === sheetName);

  if (!sheetExists) {
    console.log(`Creating missing sheet: ${sheetName}`);
    await service.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }]
      }
    });
    // Add headers
    await service.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] }
    });
  }
};

export const getSheetNames = async () => {
  const service = await initSheets();
  const metadata = await service.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  return (metadata.data.sheets || [])
    .map((s) => s?.properties?.title)
    .filter(Boolean);
};

export const getSheetData = async (range) => {
  const service = await initSheets();
  const response = await service.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: normalizeRange(range),
  });
  return response.data.values || [];
};

export const appendRow = async (range, values) => {
  const service = await initSheets();
  await service.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: normalizeRange(range),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
};

export const updateRow = async (sheetName, rowIndex, values) => {
  const service = await initSheets();
  const range = `${quoteSheetName(sheetName)}!A${rowIndex + 1}`; // Sheets is 1-indexed, and we assume A1 header
  await service.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
};

export const deleteRow = async (sheetName, rowIndex) => {
  const service = await initSheets();
  const metadata = await service.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = metadata.data.sheets.find(s => s.properties.title === sheetName);
  
  if (!sheet) throw new Error(`Sheet ${sheetName} not found`);

  await service.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: sheet.properties.sheetId,
            dimension: 'ROWS',
            startIndex: rowIndex, // 0-indexed, and start is inclusive
            endIndex: rowIndex + 1 // end is exclusive
          }
        }
      }]
    }
  });
};

export const findRowIndex = async (sheetName, columnName, value) => {
  const rows = await getSheetData(`${quoteSheetName(sheetName)}!A:Z`);
  if (!rows.length) return -1;
  
  const headers = rows[0];
  const colIndex = headers.indexOf(columnName);
  if (colIndex === -1) return -1;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][colIndex] === value) return i;
  }
  return -1;
};

export const findRowIndexByAliases = async (sheetName, aliases, value) => {
  const rows = await getSheetData(`${quoteSheetName(sheetName)}!A:Z`);
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
  return rows.slice(1).map((row) => {
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
