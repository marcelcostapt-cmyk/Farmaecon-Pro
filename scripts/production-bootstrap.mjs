import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

// Explicit one-time command. Never runs as part of API startup or a migration.
const { DATABASE_URL, OWNER_EMAIL, OWNER_PASSWORD, OWNER_NAME, COMPANY_NAME } = process.env;
let prisma;
try {
  if (!DATABASE_URL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(OWNER_EMAIL ?? '') || (OWNER_PASSWORD ?? '').length < 20 || !OWNER_NAME || !COMPANY_NAME) throw new Error('Set DATABASE_URL, OWNER_EMAIL, a strong OWNER_PASSWORD, OWNER_NAME and COMPANY_NAME in the private environment');
  prisma = new PrismaClient({ adapter: new PrismaPg(DATABASE_URL) });
  const password = await bcrypt.hash(OWNER_PASSWORD, 12);
  await prisma.$transaction(async tx => {
    if (await tx.user.count() || await tx.tenant.count()) throw new Error('Bootstrap is only allowed on an empty installation');
    const tenant = await tx.tenant.create({ data: { name: COMPANY_NAME } });
    await tx.user.create({ data: { tenantId: tenant.id, email: OWNER_EMAIL.toLowerCase(), name: OWNER_NAME, password, role: 'ADMIN' } });
  }, { isolationLevel: 'Serializable' });
  console.log('Initial company and administrator created. No simulated orders or marketplace credentials inserted.');
} catch {
  console.error('Bootstrap failed: verify private settings and confirm the installation is empty. Existing users are never overwritten.');
  process.exitCode = 1;
} finally { await prisma?.$disconnect(); }
