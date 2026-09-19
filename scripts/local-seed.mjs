import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
const url = new URL(process.env.DATABASE_URL ?? '');
if (process.env.LOCAL_SIMULATION !== 'true' || process.env.MARKETPLACE_SOURCE !== 'MOCK' || !['localhost','127.0.0.1','db'].includes(url.hostname) || url.pathname !== '/farmaecon_observation') throw new Error('Seed restricted to the isolated local observation database');
const prisma = new PrismaClient({ adapter: new PrismaPg(url.toString()) });
try {
 for (const key of ['a','b']) {
  const tenantId = `observation-${key}`;
  await prisma.tenant.upsert({ where: { id: tenantId }, update: {}, create: { id: tenantId, name: `Empresa simulada ${key.toUpperCase()}` } });
  const password = process.env[`DEMO_ADMIN_${key.toUpperCase()}_PASSWORD`];
  if (!password) throw new Error('Run local-init first');
  await prisma.user.upsert({ where: { email: `admin-${key}@observation.local` }, update: {}, create: { id: `admin-${key}`, tenantId, name: `Admin ${key.toUpperCase()}`, email: `admin-${key}@observation.local`, password: await bcrypt.hash(password,12), role: 'ADMIN' } });
  await prisma.marketplaceAccount.upsert({ where: { id: `simulated-${key}` }, update: {}, create: { id: `simulated-${key}`, tenantId, platform: 'MERCADO_LIVRE', source: 'SIMULATED', name: `Conta simulada ${key.toUpperCase()}` } });
 }
 if (!process.env.DEMO_OPERATOR_A_PASSWORD) throw new Error('Run local-init first');
 await prisma.user.upsert({ where: { email: 'operator-a@observation.local' }, update: {}, create: { id: 'operator-a', tenantId: 'observation-a', name: 'Operador A', email: 'operator-a@observation.local', password: await bcrypt.hash(process.env.DEMO_OPERATOR_A_PASSWORD,12), role: 'OPERATOR' } });
 console.log('Two local companies, isolated users and simulated accounts are ready. No marketplace requests made.');
} finally { await prisma.$disconnect(); }
