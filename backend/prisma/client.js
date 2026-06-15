/**
 * Prisma Client Singleton
 * Prevents multiple instances during dev hot-reloads and Vercel serverless warm starts.
 * Handles Neon serverless connection drops with automatic reconnect.
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

function createPrismaClient() {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  // Neon serverless closes idle connections — transparently reconnect on next query.
  // The `$on('error')` hook catches the "connection closed" event and calls $connect()
  // so the next query succeeds without crashing the process.
  client.$on('error', async (e) => {
    if (e.message?.includes('Closed') || e.message?.includes('connection')) {
      console.warn('[Prisma] Connection lost — reconnecting...');
      try { await client.$connect(); } catch { /* will retry on next query */ }
    }
  });

  return client;
}

const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export const withTenant = (tenantId) => {
  if (!tenantId) return prisma;
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await prisma.$transaction([
            prisma.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${tenantId}';`),
            query(args),
          ]);
          return result;
        },
      },
    },
  });
};

export default prisma;
