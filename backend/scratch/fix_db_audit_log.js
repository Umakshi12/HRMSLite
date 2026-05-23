import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting Neon database AuditLog constraint fix...');

  try {
    // 1. Drop the existing foreign key constraint to prevent validation failure during updates
    console.log('Step 1: Dropping the old foreign key constraint "AuditLog_actor_id_fkey"...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_actor_id_fkey";
    `);
    console.log('✅ Dropped the constraint successfully (or it did not exist).');

    // 2. Map existing actor_id values from User.login_id (old schema) to User.id (new schema UUID)
    console.log('Step 2: Mapping AuditLog.actor_id from User.login_id strings to User.id UUIDs...');
    const updateResult = await prisma.$executeRawUnsafe(`
      UPDATE "AuditLog"
      SET "actor_id" = u."id"
      FROM "User" u
      WHERE "AuditLog"."actor_id" = u."login_id";
    `);
    console.log(`✅ Successfully mapped actor_id values. Rows affected: ${updateResult}`);

    // 3. Set actor_id to NULL for any records that do not point to a valid User.id
    console.log('Step 3: Setting orphaned or invalid actor_id values to NULL to prevent foreign key errors...');
    const nullifyResult = await prisma.$executeRawUnsafe(`
      UPDATE "AuditLog"
      SET "actor_id" = NULL
      WHERE "actor_id" NOT IN (SELECT "id" FROM "User") AND "actor_id" IS NOT NULL;
    `);
    console.log(`✅ Cleared orphaned actor_id values. Rows affected: ${nullifyResult}`);

    console.log('\n🎉 Database pre-migration updates completed successfully!');
    console.log('👉 You can now safely run: npx prisma db push');
  } catch (error) {
    console.error('❌ Error executing database fixes:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
