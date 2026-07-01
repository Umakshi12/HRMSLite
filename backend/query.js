const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const spreadsheets = await prisma.spreadsheet.findMany({ include: { tabs: true } });
  console.log('Spreadsheets:');
  console.dir(spreadsheets, { depth: null });

  const tabAccess = await prisma.userTabAccess.findMany();
  console.log('\nTab Access:');
  console.dir(tabAccess, { depth: null });
}

main().catch(console.error).finally(() => prisma.$disconnect());
