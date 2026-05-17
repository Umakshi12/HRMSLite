import db from './db.js';
import prisma from './prisma/client.js';

async function runDiag() {
  console.log('--- DB Diagnostic ---');
  try {
    const userCount = await prisma.user.count();
    console.log('Total Users in DB:', userCount);

    const superAdmin = await prisma.user.findFirst({ where: { role: 'super_admin' } });
    console.log('Super Admin found:', superAdmin ? superAdmin.login_id : 'NO');

    if (superAdmin) {
      console.log('Testing getUsers for Super Admin:', superAdmin.login_id);
      const result = await db.getUsers(superAdmin.login_id);
      console.log('Result count:', result.users.length);
      if (result.users.length === 0) {
        console.log('WARNING: Super Admin sees 0 users. This confirms the visibility bug.');
      }
    }

    console.log('Testing getAdminDashboard...');
    const dash = await db.getAdminDashboard();
    console.log('Dashboard Admins:', dash.admins.length);
    console.log('Dashboard Stats:', JSON.stringify(dash.stats, null, 2));

  } catch (err) {
    console.error('DIAGNOSTIC FAILED:', err);
  } finally {
    await prisma.$disconnect();
  }
}

runDiag();
