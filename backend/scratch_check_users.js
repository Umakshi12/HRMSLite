import * as sheetsAPI from './googleSheetsService.js';
import dotenv from 'dotenv';
dotenv.config();

async function checkUsers() {
  try {
    const rows = await sheetsAPI.getSheetData('Users!A:Z');
    console.log('USERS_ROWS_START');
    console.log(JSON.stringify(rows));
    console.log('USERS_ROWS_END');
  } catch (e) {
    console.error('Error reading Users sheet:', e.message);
  }
}

checkUsers();
