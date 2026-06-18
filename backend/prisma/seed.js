/**
 * Prisma Seed — SheetSync Pro
 * Run: npm run db:seed
 *
 * Upserts the Super Admin — safe to run multiple times.
 * Reads credentials from env vars (same ones as server.js bootstrap).
 * Set in Vercel → Settings → Environment Variables:
 *   BOOTSTRAP_ADMIN_EMAIL    = superadmin@sheetsync.pro
 *   BOOTSTRAP_ADMIN_LOGIN_ID = sheetsync_superadmin
 *   BOOTSTRAP_ADMIN_PASSWORD = <your-password>
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Single source of truth — same vars used in server.js ensureSuperAdmin()
  const email    = process.env.BOOTSTRAP_ADMIN_EMAIL    || 'superadmin@sheetsync.pro';
  const loginId  = process.env.BOOTSTRAP_ADMIN_LOGIN_ID || 'superadmin_root';
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'Admin@123456';

  const hash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { login_id: loginId },
    update: { password: hash, identifier: email },
    create: {
      login_id:       loginId,
      name:           'Super Admin',
      identifier:     email,
      phone:          null,
      password:       hash,
      role:           'super_admin',
      plan:           'pro',
      status:         'active',
      max_user_quota: 9999,
      notes:          'System-seeded super admin. Change password on first login.',
      created_by:     'system',
    },
  });

  console.log(`[Seed] ✅ Super Admin upserted — login_id: ${loginId}  email: ${email}`);
  console.log('[Seed] ⚠️  Change the password immediately after first login!');
}

main()
  .catch((e) => { console.error('[Seed] Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
