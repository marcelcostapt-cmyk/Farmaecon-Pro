import { Test } from '@nestjs/testing';
import { BadRequestException, Global, INestApplication, Module, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { inTenant } from '../src/shared/prisma/tenant-context';
import { AdsService } from '../src/modules/ads/ads.service';

// Custos de ADS em PostgreSQL REAL: importação CSV, idempotência, resumo e isolamento por tenant.

@Global()
@Module({ providers: [PrismaService, AdsService], exports: [PrismaService, AdsService] })
class TestDatabase {}

describe('Custos de ADS — PostgreSQL real', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let ads: AdsService;
  const prefix = `ads-${randomUUID()}`;
  const tenantA = `${prefix}-a`;
  const tenantB = `${prefix}-b`;
  const accountA = `${prefix}-acc`;
  const accountB = `${prefix}-accB`;
  const csv = 'data;sku;campanha;valor\n2026-11-10;ABC;Black;100,50\n2026-11-11;ABC;Black;49,50\n2026-11-11;;Geral;20\n';

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://missing');
    const ownerUrl = new URL(process.env.TEST_OWNER_DATABASE_URL ?? 'http://missing');
    if (!url.pathname.includes('test') || url.username !== 'farmaecon_runtime' || ownerUrl.pathname !== url.pathname) {
      throw new Error('Exige BD de teste local com ligações runtime e owner coincidentes');
    }
    owner = new PrismaClient({ adapter: new PrismaPg(ownerUrl.toString()) });
    const module = await Test.createTestingModule({ imports: [TestDatabase] }).compile();
    app = module.createNestApplication();
    await app.init();
    ads = module.get(AdsService);
    for (const id of [tenantA, tenantB]) await owner.tenant.create({ data: { id, name: id } });
    await owner.marketplaceAccount.create({ data: { id: accountA, tenantId: tenantA, platform: 'MERCADO_LIVRE', name: 'ML #ads', source: 'SIMULATED', status: 'ACTIVE' } });
    await owner.marketplaceAccount.create({ data: { id: accountB, tenantId: tenantB, platform: 'MERCADO_LIVRE', name: 'ML #adsB', source: 'SIMULATED', status: 'ACTIVE' } });
  });

  afterAll(async () => {
    const tenants = { in: [tenantA, tenantB] };
    await owner?.adsCost.deleteMany({ where: { tenantId: tenants } });
    await owner?.marketplaceAccount.deleteMany({ where: { tenantId: tenants } });
    await owner?.tenant.deleteMany({ where: { id: tenants } });
    await owner?.$disconnect();
    await app?.close();
  });

  it('importa o CSV e resume por SKU e sem SKU', async () => {
    const r = await inTenant(tenantA, () => ads.importCsv(tenantA, accountA, csv, `${prefix}-h1`));
    expect(r).toEqual({ received: 3, imported: 3, skipped: 0 });
    const s = await inTenant(tenantA, () => ads.summary(tenantA, accountA));
    expect(s.total).toBe('170');
    expect(s.unallocated).toBe('20');
    expect(s.bySku).toEqual([{ sku: 'ABC', amount: '150' }]);
  });

  it('reimportar o mesmo ficheiro é idempotente (nada duplicado)', async () => {
    const r = await inTenant(tenantA, () => ads.importCsv(tenantA, accountA, csv, `${prefix}-h1`));
    expect(r).toEqual({ received: 3, imported: 0, skipped: 3 });
    const s = await inTenant(tenantA, () => ads.summary(tenantA, accountA));
    expect(s.total).toBe('170');
  });

  it('filtra o resumo por período', async () => {
    const s = await inTenant(tenantA, () =>
      ads.summary(tenantA, accountA, new Date('2026-11-11T00:00:00.000Z'), new Date('2026-11-11T00:00:00.000Z')),
    );
    expect(s.total).toBe('69.5');
    expect(s.bySku).toEqual([{ sku: 'ABC', amount: '49.5' }]);
  });

  it('recusa ficheiro com erros e não grava nenhuma linha', async () => {
    await expect(
      inTenant(tenantA, () => ads.importCsv(tenantA, accountA, 'data;valor\n2026-99-01;10\n', `${prefix}-h2`)),
    ).rejects.toThrow(BadRequestException);
    const s = await inTenant(tenantA, () => ads.summary(tenantA, accountA));
    expect(s.total).toBe('170');
  });

  it('conta de outro tenant não aceita importação', async () => {
    await expect(inTenant(tenantB, () => ads.importCsv(tenantB, accountA, csv, `${prefix}-h3`))).rejects.toThrow(NotFoundException);
  });

  it('isola por tenant: tenant B não vê o gasto de A', async () => {
    const s = await inTenant(tenantB, () => ads.summary(tenantB, accountB));
    expect(s).toEqual({ total: '0', unallocated: '0', bySku: [] });
  });
});
