/**
 * Prisma Seed — SheetSync Pro
 * Run: npm run db:seed
 *
 * Creates the default Super Admin account if it doesn't exist yet.
 * Credentials: admin@sheetsync.pro / Admin@123456
 * CHANGE THE PASSWORD immediately after first login.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const SUPER_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@sheetsync.pro';
  const SUPER_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin@123456';

  const existing = await prisma.user.findUnique({ where: { identifier: SUPER_ADMIN_EMAIL } });

  if (existing) {
    console.log(`[Seed] Super Admin already exists: ${SUPER_ADMIN_EMAIL}`);
    return;
  }

  const hashedPassword = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);

  const admin = await prisma.user.create({
    data: {
      login_id:       'superadmin_root',
      name:           'Super Admin',
      identifier:     SUPER_ADMIN_EMAIL,
      phone:          null,
      password:       hashedPassword,
      role:           'super_admin',
      plan:           'pro',
      status:         'active',
      max_user_quota: 9999,
      notes:          'System-seeded super admin. Change password on first login.',
      created_by:     'system',
    },
  });

  console.log(`[Seed] Created Super Admin:`);
  console.log(`  Login ID : ${admin.login_id}`);
  console.log(`  Email    : ${admin.identifier}`);
  console.log(`  Password : ${SUPER_ADMIN_PASSWORD}  ← CHANGE THIS IMMEDIATELY`);
}

main()
  .catch((e) => { console.error('[Seed] Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
