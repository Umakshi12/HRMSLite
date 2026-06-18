/**
 * Pre-build DB cleanup script
 * Run before `prisma db push` to nullify orphaned FK references.
 * Prevents: "foreign key constraint violation" during schema sync.
 *
 * Usage: node scripts/clean-orphans.mjs
 */
import { createRequire } from 'module';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function cleanOrphanedRefs() {
  await client.connect();
  console.log('[PreBuild] Connected to DB — cleaning orphaned references...');

  try {
    // Nullify AuditLog.actor_id where the User no longer exists
    const result = await client.query(`
      UPDATE "AuditLog"
      SET actor_id = NULL
      WHERE actor_id IS NOT NULL
        AND actor_id NOT IN (SELECT id FROM "User")
    `);
    console.log(`[PreBuild] ✅ AuditLog orphans cleared: ${result.rowCount} rows updated`);

    // Nullify ActivityLog tenant_id where Tenant no longer exists (safety net)
    const result2 = await client.query(`
      UPDATE "ActivityLog"
      SET tenant_id = NULL
      WHERE tenant_id IS NOT NULL
        AND tenant_id NOT IN (SELECT id FROM "Tenant")
    `).catch(() => ({ rowCount: 0 })); // table may not exist yet
    console.log(`[PreBuild] ✅ ActivityLog orphans cleared: ${result2.rowCount} rows updated`);

  } catch (e) {
    // Non-fatal — log and continue so build doesn't fail on a clean DB
    console.warn('[PreBuild] Warning during cleanup (safe to ignore on fresh DB):', e.message);
  } finally {
    await client.end();
    console.log('[PreBuild] Done.');
  }
}

cleanOrphanedRefs();
