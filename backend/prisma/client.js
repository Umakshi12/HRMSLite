/**
 * Prisma Client Singleton
 * Prevents multiple instances during dev hot-reloads and Vercel serverless warm starts.
 * Handles Neon serverless connection drops with automatic reconnect + exponential backoff.
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

function createPrismaClient() {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' 
      ? [{ emit: 'event', level: 'error' }, { emit: 'stdout', level: 'warn' }] 
      : [{ emit: 'event', level: 'error' }],
  });

  // Neon serverless closes idle connections — transparently reconnect with backoff.
  // Backoff prevents flooding Neon with concurrent reconnect storms.
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 3;

  client.$on('error', async (e) => {
    if (e.message?.includes('Closed') || e.message?.includes('connection') || e.message?.includes('ECONNRESET')) {
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error('[Prisma] Max reconnect attempts reached — next query will retry automatically');
        reconnectAttempts = 0;
        return;
      }
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 8000); // 1s, 2s, 4s, 8s cap
      reconnectAttempts++;
      console.warn(`[Prisma] Connection lost — reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
      await new Promise(r => setTimeout(r, delay));
      try {
        await client.$connect();
        reconnectAttempts = 0; // reset on success
      } catch {
        /* will retry on next query */ 
      }
    }
  });

  return client;
}

const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Clean up connections gracefully on shutdown
process.on('beforeExit', async () => { try { await prisma.$disconnect(); } catch {} });

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
