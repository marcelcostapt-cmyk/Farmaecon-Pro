import { Test } from '@nestjs/testing';
import { Global, Module, INestApplication, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { inTenant } from '../src/shared/prisma/tenant-context';
import { IntegrationsService } from '../src/modules/integrations/integrations.service';

// Prova de escrita da identidade da conta contra um PostgreSQL REAL (§6 casos 1-4):
// PATCH parcial persiste de verdade, CNPJ inválido não modifica, isolamento por RLS.
// Ligação runtime = farmaecon_runtime (sob RLS); owner só provisiona fixtures.

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
class TestDatabase {}

const stubQueue = { add: async () => undefined, getJobs: async () => [] } as never;
const actor = { sub: 'u-1', tenantId: '', role: 'ADMIN', sid: 's' };

describe('Identidade da conta — PostgreSQL real', () => {
  let app: INestApplication;
  let db: PrismaService;
  let owner: PrismaClient;
  let service: IntegrationsService;
  const prefix = `ident-${randomUUID()}`;
  const tenantA = `${prefix}-a`;
  const tenantB = `${prefix}-b`;
  const accA = `${prefix}-acc-a`;
  const accB = `${prefix}-acc-b`;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://missing');
    if (!['localhost', '127.0.0.1', 'db'].includes(url.hostname) || !url.pathname.includes('test')) {
      throw new Error('É obrigatória uma BD de teste local e explicitamente nomeada');
    }
    const ownerUrl = new URL(process.env.TEST_OWNER_DATABASE_URL ?? 'http://missing');
    if (url.username !== 'farmaecon_runtime' || ownerUrl.hostname !== url.hostname || ownerUrl.port !== url.port || ownerUrl.pathname !== url.pathname) {
      throw new Error('São exigidas ligações runtime (restrita) e owner (fixtures) coincidentes');
    }
    owner = new PrismaClient({ adapter: new PrismaPg(ownerUrl.toString()) });
    const module = await Test.createTestingModule({ imports: [TestDatabase] }).compile();
    app = module.createNestApplication();
    await app.init();
    db = module.get(PrismaService);
    service = new IntegrationsService(db, stubQueue, stubQueue, {} as never, {} as never, undefined);

    for (const [tenantId, accId, seller] of [[tenantA, accA, '111'], [tenantB, accB, '222']] as const) {
      await owner.tenant.create({ data: { id: tenantId, name: tenantId } });
      await owner.marketplaceAccount.create({
        data: {
          id: accId, tenantId, platform: 'MERCADO_LIVRE', status: 'ACTIVE', externalSellerId: seller,
          name: `ML #${seller}`, displayName: 'Loja', accessToken: 'enc-access', refreshToken: 'enc-refresh',
          businessName: 'DROGARIA EXEMPLO LTDA', businessNameNormalized: 'DROGARIA EXEMPLO', cnpj: '11222333000181',
        },
      });
    }
  });

  afterAll(async () => {
    await owner?.marketplaceAccount.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await owner?.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await owner?.$disconnect();
    await app?.close();
  });

  const read = (accId: string, tenantId: string) =>
    owner.marketplaceAccount.findUniqueOrThrow({ where: { id: accId }, select: { displayName: true, businessName: true, businessNameNormalized: true, cnpj: true } });

  it('§6.1 — altera só displayName e preserva razão social/CNPJ (persistência real)', async () => {
    await inTenant(tenantA, () => service.updateIdentity(tenantA, accA, { ...actor, tenantId: tenantA } as never, { displayName: 'Novo' }));
    expect(await read(accA, tenantA)).toEqual({ displayName: 'Novo', businessName: 'DROGARIA EXEMPLO LTDA', businessNameNormalized: 'DROGARIA EXEMPLO', cnpj: '11222333000181' });
  });

  it('§6.2 — atualiza razão social (e normalizada) sem apagar o CNPJ', async () => {
    await inTenant(tenantA, () => service.updateIdentity(tenantA, accA, { ...actor, tenantId: tenantA } as never, { businessName: 'Maxifarmá EIRELI' }));
    const row = await read(accA, tenantA);
    expect(row.businessName).toBe('Maxifarmá EIRELI');
    expect(row.businessNameNormalized).toBe('MAXIFARMA');
    expect(row.cnpj).toBe('11222333000181');
  });

  it('§6.3 — CNPJ inválido é rejeitado SEM modificar o registo', async () => {
    await expect(
      inTenant(tenantA, () => service.updateIdentity(tenantA, accA, { ...actor, tenantId: tenantA } as never, { cnpj: '11222333000182' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await read(accA, tenantA)).cnpj).toBe('11222333000181');
  });

  it('§6.3 — aceita CNPJ alfanumérico válido e guarda normalizado', async () => {
    await inTenant(tenantA, () => service.updateIdentity(tenantA, accA, { ...actor, tenantId: tenantA } as never, { cnpj: '12.ABC.345/01DE-35' }));
    expect((await read(accA, tenantA)).cnpj).toBe('12ABC34501DE35');
  });

  it('limpa o CNPJ com null explícito, preservando a razão social', async () => {
    await inTenant(tenantA, () => service.updateIdentity(tenantA, accA, { ...actor, tenantId: tenantA } as never, { cnpj: null }));
    const row = await read(accA, tenantA);
    expect(row.cnpj).toBeNull();
    expect(row.businessName).toBe('Maxifarmá EIRELI');
  });

  it('§6.4 — bloqueia edição entre tenants: tenant B não altera a conta de A (RLS/escopo)', async () => {
    await expect(
      inTenant(tenantB, () => service.updateIdentity(tenantB, accA, { ...actor, tenantId: tenantB } as never, { displayName: 'Invasor' })),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Contraprova: a conta de B não enxerga a de A por RLS.
    const vistasPorB = await inTenant(tenantB, () => db.marketplaceAccount.findMany({ where: {}, select: { id: true } }));
    expect(vistasPorB.map((r) => r.id)).toEqual([accB]);
  });
});
