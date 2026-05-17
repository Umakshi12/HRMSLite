import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  try {
    console.log('Checking database connection...');
    const userCount = await prisma.user.count();
    console.log(`Connection successful. User count: ${userCount}`);
    
    const superAdmin = await prisma.user.findFirst({
      where: { role: 'super_admin' }
    });
    console.log('Super Admin exists:', !!superAdmin);
    if (superAdmin) {
      console.log('Super Admin Login ID:', superAdmin.login_id);
    }

    const admins = await prisma.user.findMany({
      where: { role: 'admin' }
    });
    console.log('Admin count:', admins.length);

  } catch (err) {
    console.error('Database check failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

check();
