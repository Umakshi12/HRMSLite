const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const user = await prisma.user.findFirst({ where: { identifier: 'user@gmail.com' } });
  if (!user) return console.log('user not found');
  const grants = await prisma.userTabAccess.findMany({ where: { user_id: user.login_id } });
  console.log(grants);
}
run();
