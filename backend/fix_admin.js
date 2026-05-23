import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const adminEmail = 'admin@sheetsync.pro';
  
  const user = await prisma.user.findFirst({
    where: { identifier: adminEmail }
  });

  if (!user) {
    console.log(`User ${adminEmail} not found in database.`);
    return;
  }

  console.log(`Found user: ${user.identifier} (Current Role: ${user.role})`);

  if (user.role !== 'super_admin') {
    await prisma.user.update({
      where: { id: user.id },
      data: { role: 'super_admin' }
    });
    console.log(`Successfully restored role to 'super_admin' for ${adminEmail}.`);
  } else {
    console.log(`User is already a 'super_admin'.`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
