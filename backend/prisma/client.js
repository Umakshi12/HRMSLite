/**
 * Prisma Client Singleton
 * Prevents multiple instances during dev hot-reloads and Vercel serverless warm starts.
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

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
