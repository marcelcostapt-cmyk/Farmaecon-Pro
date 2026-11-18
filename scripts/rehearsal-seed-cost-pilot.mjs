// Semeia, de forma idempotente, os dados mínimos do piloto de custos no ambiente de ENSAIO:
// um tenant, um utilizador ADMIN e uma conta ML sintética cujo CNPJ casa com a fixture
// apps/api/test/fixtures/nfe-bonificacao-sintetica.xml (vínculo automático documento→conta).
//
// NUNCA correr contra produção. Guarda tripla: MARKETPLACE_SOURCE=MOCK, host local e o
// nome exato da base de dados do ensaio. Dados 100% fictícios — nenhum dado real.
//
// Uso (dentro da rede do compose de ensaio, onde "db" resolve):
//   MARKETPLACE_SOURCE=MOCK PILOT_ADMIN_PASSWORD=<senha> \
//   DATABASE_URL=postgresql://farmaecon:rehearsal_postgres_password_32chars@db:5432/farmaecon_rehearsal_db \
//   node scripts/rehearsal-seed-cost-pilot.mjs

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const REHEARSAL_DB = '/farmaecon_rehearsal_db';
const CNPJ_FIXTURE = '00000000000272'; // == <dest><CNPJ> da fixture sintética

const url = new URL(process.env.DATABASE_URL ?? '');
if (
  process.env.MARKETPLACE_SOURCE !== 'MOCK' ||
  !['localhost', '127.0.0.1', 'db'].includes(url.hostname) ||
  url.pathname !== REHEARSAL_DB
) {
  throw new Error('Seed restrito à base de dados isolada do ENSAIO (farmaecon_rehearsal_db, host local, MARKETPLACE_SOURCE=MOCK).');
}

const password = process.env.PILOT_ADMIN_PASSWORD;
if (!password || password.length < 12) {
  throw new Error('Defina PILOT_ADMIN_PASSWORD (≥ 12 caracteres) para o utilizador ADMIN do piloto.');
}

const TENANT_ID = 'rehearsal-cost-pilot';
const ADMIN_EMAIL = 'admin-cost-pilot@rehearsal.local';
const ACCOUNT_ID = 'a1b2c3d4-0000-4000-8000-000000000001'; // UUID fixo: o endpoint :id/account exige accountId UUID

const prisma = new PrismaClient({ adapter: new PrismaPg(url.toString()) });
try {
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: { id: TENANT_ID, name: 'Ensaio — Piloto de Custos' },
  });

  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { password: await bcrypt.hash(password, 12), role: 'ADMIN' },
    create: {
      id: 'admin-cost-pilot',
      tenantId: TENANT_ID,
      name: 'Admin Piloto',
      email: ADMIN_EMAIL,
      password: await bcrypt.hash(password, 12),
      role: 'ADMIN',
    },
  });

  await prisma.marketplaceAccount.upsert({
    where: { id: ACCOUNT_ID },
    update: { cnpj: CNPJ_FIXTURE, status: 'ACTIVE' },
    create: {
      id: ACCOUNT_ID,
      tenantId: TENANT_ID,
      platform: 'MERCADO_LIVRE',
      source: 'SIMULATED',
      status: 'ACTIVE',
      name: 'ML #1773172867',
      displayName: 'Droga Domínio (ensaio)',
      externalSellerId: '1773172867',
      cnpj: CNPJ_FIXTURE,
      businessName: 'DROGARIA SINTETICA LTDA',
    },
  });

  console.log(`Piloto de custos pronto no ENSAIO: tenant=${TENANT_ID}, admin=${ADMIN_EMAIL}, conta=${ACCOUNT_ID} (CNPJ ${CNPJ_FIXTURE}). Nenhum pedido ao marketplace.`);
} finally {
  await prisma.$disconnect();
}
