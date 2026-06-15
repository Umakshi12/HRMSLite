import * as sheetsAPI from './googleSheetsService.js';
import { hashPassword } from './auth.js';
import dotenv from 'dotenv';

dotenv.config();

const ADMIN_EMAIL    = process.env.BOOTSTRAP_ADMIN_EMAIL    || 'admin@sheetsync.pro';
const ADMIN_LOGIN_ID = process.env.BOOTSTRAP_ADMIN_LOGIN_ID || 'sheetsync_admin01';
const ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD;

const USERS_SHEET        = 'Users';
const USERS_HEADERS      = ['Login ID', 'Identifier', 'Password', 'Role', 'Status', 'Last Login', 'Sheet Access', 'Created At'];
const ACTIVITY_SHEET     = 'ActivityLog';
const ACTIVITY_HEADERS   = ['Action', 'User', 'Details', 'Timestamp'];

const bootstrap = async () => {
  console.log('🚀 Starting SheetSync Pro Bootstrap...');

  if (!ADMIN_PASSWORD) {
    console.error('❌ BOOTSTRAP_ADMIN_PASSWORD is not set in .env. Aborting.');
    process.exit(1);
  }

  try {
    // Ensure only these two sheets exist — all other sheets are created by the user via the app
    await sheetsAPI.ensureSheetExists(USERS_SHEET, USERS_HEADERS);
    await sheetsAPI.ensureSheetExists(ACTIVITY_SHEET, ACTIVITY_HEADERS);

    // Read existing rows to check if an admin is already present
    // Uses full dynamic range — no hardcoded column count
    let rows = [];
    try {
      rows = await sheetsAPI.getSheetData(`${USERS_SHEET}!A:Z`);
    } catch {
      // Sheet was just created — no rows yet
    }

    // Map headers dynamically so column order doesn't matter
    const headers = rows[0] || USERS_HEADERS;
    const loginIdCol  = headers.findIndex(h => /login.?id/i.test(h));
    const identifierCol = headers.findIndex(h => /identifier|email/i.test(h));

    const adminExists = rows.slice(1).some(row =>
      (identifierCol >= 0 && row[identifierCol] === ADMIN_EMAIL) ||
      (loginIdCol    >= 0 && row[loginIdCol]    === ADMIN_LOGIN_ID)
    );

    if (!adminExists) {
      console.log(`Creating initial super admin: ${ADMIN_EMAIL} (login: ${ADMIN_LOGIN_ID})`);
      const hashedPassword = await hashPassword(ADMIN_PASSWORD);

      // Build row aligned to actual header order
      const rowMap = {
        'Login ID':     ADMIN_LOGIN_ID,
        'Identifier':   ADMIN_EMAIL,
        'Password':     hashedPassword,
        'Role':         'super_admin',
        'Status':       'active',
        'Last Login':   '',
        'Sheet Access': JSON.stringify(['All']),
        'Created At':   new Date().toISOString(),
      };
      const row = headers.map(h => rowMap[h] ?? '');

      await sheetsAPI.appendRow(`${USERS_SHEET}!A:A`, row);
      console.log('✅ Super admin created successfully!');
      console.log(`   Login ID : ${ADMIN_LOGIN_ID}`);
      console.log(`   Email    : ${ADMIN_EMAIL}`);
      console.log('   Password : (as set in BOOTSTRAP_ADMIN_PASSWORD)');
    } else {
      console.log('ℹ️  Super admin already exists — skipping creation.');
    }

    console.log('🎉 Bootstrap complete! You can now log in.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Bootstrap failed:', err.message);
    process.exit(1);
  }
};

bootstrap();
