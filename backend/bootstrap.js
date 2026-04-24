import db from './db.js';
import * as sheetsAPI from './googleSheetsService.js';
import { hashPassword } from './auth.js';

const ADMIN_EMAIL = 'admin@staffurs.com';
const ADMIN_PASSWORD = 'admin123456';

const bootstrap = async () => {
  console.log('🚀 Starting Production Bootstrap...');

  try {
    // 1. Ensure core sheets exist
    await sheetsAPI.ensureSheetExists('Users', [
      'Login ID', 'Identifier', 'Password', 'Role', 'Status', 'Last Login', 'Sheet Access', 'Created At'
    ]);
    await sheetsAPI.ensureSheetExists('ActivityLog', [
      'Action', 'User', 'Details', 'Timestamp'
    ]);

    // Ensure category sheets exist (Optional but recommended)
    const categories = ['Japa', 'Elderly Care', 'Patient Care', 'Newborn Baby Care', 'Cook', 'Driver', 'Maid / Housekeeping'];
    const candidateHeaders = [
      'Sr No', 'Name', 'Address', 'State', 'Marital Status', 'Timing', 'Area', 'Experience', 'Education', 'DOB', 'Age', 'Gender', 'Salary', 'Mobile', 'Verification', 'Description', 'Since'
    ];
    for (const cat of categories) {
      await sheetsAPI.ensureSheetExists(cat, candidateHeaders);
    }

    // 2. Create initial Admin if not exists
    const usersData = await sheetsAPI.getSheetData('Users!A:B');
    const userExists = usersData.some(row => row[1] === ADMIN_EMAIL);

    if (!userExists) {
      console.log(`Creating initial admin: ${ADMIN_EMAIL}`);
      const hashedPassword = await hashPassword(ADMIN_PASSWORD);
      const row = [
        'staffurs_admin01',
        ADMIN_EMAIL,
        hashedPassword,
        'Super Admin',
        'active',
        '',
        JSON.stringify(['All']),
        new Date().toISOString()
      ];
      await sheetsAPI.appendRow('Users!A:H', row);
      console.log('✅ Admin created successfully!');
    } else {
      console.log('ℹ️ Admin user already exists.');
    }

    console.log('🎉 Bootstrap complete! You can now log in.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Bootstrap failed:', err.message);
    process.exit(1);
  }
};

bootstrap();
