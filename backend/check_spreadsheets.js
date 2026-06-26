const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const spreadsheets = await prisma.spreadsheet.findMany();
  console.log(JSON.stringify(spreadsheets, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
