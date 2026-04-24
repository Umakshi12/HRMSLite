import { google } from 'googleapis';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH;

const inspect = async () => {
  console.log('🔍 Auditing Google Spreadsheet Data...');

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`❌ Error: Credentials file missing at ${CREDENTIALS_PATH}`);
    process.exit(1);
  }

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    // 1. Get Spreadsheet Metadata
    const metadata = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheetNames = metadata.data.sheets.map(s => s.properties.title);
    
    console.log(`\n📄 Sheets Found (${sheetNames.length}):`, sheetNames.join(', '));

    // 2. Inspect each sheet for headers and row counts
    for (const name of sheetNames) {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${name}!A1:Z2`, // Get headers and first row
      });

      const rows = response.data.values || [];
      const headers = rows[0] || [];
      const rowCount = rows.length > 1 ? 'Many rows detected' : (rows.length === 1 ? 'Header only' : 'Empty');

      console.log(`\n--- Sheet: [${name}] ---`);
      console.log(`Headers: ${headers.join(' | ')}`);
      console.log(`Status: ${rowCount}`);
      if (rows[1]) {
        console.log(`Sample Data: ${rows[1].slice(0, 3).join(' | ')}...`);
      }
    }

    console.log('\n✅ Inspection Complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Inspection Failed:', err.message);
    process.exit(1);
  }
};

inspect();
