import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

async function testConnection(name, url) {
  console.log(`Testing connection: ${name}...`);
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: url,
      },
    },
  });

  try {
    const result = await prisma.$queryRaw`SELECT 1 as result`;
    console.log(`${name} SUCCESS:`, result);
  } catch (error) {
    console.error(`${name} FAILED:`, error.message);
    if (error.code) console.error(`Code: ${error.code}`);
    if (error.meta) console.error(`Meta:`, error.meta);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await testConnection('DATABASE_URL (Pooler)', process.env.DATABASE_URL);
  console.log('---');
  await testConnection('DIRECT_URL (Non-Pooler)', process.env.DIRECT_URL);
}

main();
