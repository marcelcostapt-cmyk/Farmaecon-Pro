import { Test } from '@nestjs/testing';
import { Global, Module, INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { inTenant } from '../src/shared/prisma/tenant-context';
import { PurchaseInvoiceService } from '../src/modules/dre/purchase-invoice.service';
import { CostPublicationService } from '../src/modules/dre/cost-publication.service';
import { parseDocument } from '../src/modules/costs/document-parser';
import { money } from '../src/modules/costs/cost-money';

// Prova em PostgreSQL REAL do fluxo de publicação de custos: ingest → applyBonus
// (PROPORTIONAL, §H) → publishCosts grava product_costs APPROVED; e as guardas
// (documento sem conta, duplo publish) bloqueiam. Ligação runtime = farmaecon_runtime (RLS).

@Global()
@Module({
  providers: [PrismaService, PurchaseInvoiceService, CostPublicationService],
  exports: [PrismaService, PurchaseInvoiceService, CostPublicationService],
})
class TestDatabase {}

describe('DRE publicação de custos — PostgreSQL real', () => {
  let app: INestApplication;
  let db: PrismaService;
  let owner: PrismaClient;
  let ingest: PurchaseInvoiceService;
  let publication: CostPublicationService;
  const prefix = `dre-pub-${randomUUID()}`;
  const tenantA = `${prefix}-a`;
  const tenantB = `${prefix}-b`;
  const accountA = `${prefix}-acc`;
  const CNPJ = '00000000000272';

  const doc = async () =>
    parseDocument('nfe-bonificacao-sintetica.xml', readFileSync(join(__dirname, 'fixtures', 'nfe-bonificacao-sintetica.xml')));

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
    db = module.get(PrismaService);
    ingest = module.get(PurchaseInvoiceService);
    publication = module.get(CostPublicationService);
    for (const id of [tenantA, tenantB]) await owner.tenant.create({ data: { id, name: id } });
    await owner.marketplaceAccount.create({
      data: {
        id: accountA, tenantId: tenantA, platform: 'MERCADO_LIVRE', name: 'ML #1773172867',
        source: 'SIMULATED', status: 'ACTIVE', cnpj: CNPJ, businessName: 'DROGARIA SINTETICA LTDA',
      },
    });
  });

  afterAll(async () => {
    const tenants = { in: [tenantA, tenantB] };
    await owner?.productCost.deleteMany({ where: { tenantId: tenants } });
    await owner?.costAllocationRule.deleteMany({ where: { tenantId: tenants } });
    await owner?.purchaseInvoiceItem.deleteMany({ where: { tenantId: tenants } });
    await owner?.purchaseInvoice.deleteMany({ where: { tenantId: tenants } });
    await owner?.marketplaceAccount.deleteMany({ where: { tenantId: tenants } });
    await owner?.tenant.deleteMany({ where: { id: tenants } });
    await owner?.$disconnect();
    await app?.close();
  });

  it('ingest → applyBonus(PROPORTIONAL) → publishCosts grava product_costs APPROVED com os custos esperados', async () => {
    const d = await doc();
    const ing = await inTenant(tenantA, () => ingest.ingest(tenantA, d, null));
    expect(ing.created).toBe(true);
    expect(ing.accountMatch?.linkedAccountId).toBe(accountA); // auto-vínculo por CNPJ

    await inTenant(tenantA, () => publication.applyBonus(tenantA, ing.invoiceId, { hasBonus: true, bonusAmount: money('40'), rule: 'PROPORTIONAL' }, { sub: 'u1' }));
    const res = await inTenant(tenantA, () => publication.publishCosts(tenantA, ing.invoiceId, { sub: 'u1' }));
    expect(res.publishedCount).toBe(2);
    expect(res.ruleType).toBe('PROPORTIONAL_SPREAD');

    const costs = await inTenant(tenantA, () => db.productCost.findMany({ where: { tenantId: tenantA } }));
    expect(costs).toHaveLength(2);
    expect(costs.every((c) => c.status === 'APPROVED')).toBe(true);
    expect(costs.every((c) => c.marketplaceAccountId === accountA)).toBe(true);
    expect(costs.every((c) => c.costAllocationRuleId && c.sourceInvoiceItemId)).toBe(true);
    const byEan = (ean: string) => costs.find((c) => c.ean === ean)!;
    expect(byEan('7897777700011').unitCost.toString()).toBe('11');
    expect(byEan('7897777700022').unitCost.toString()).toBe('33');
    expect(byEan('7897777700011').validFrom).toEqual(new Date('2026-04-10T13:00:00.000Z'));

    const inv = await inTenant(tenantA, () => db.purchaseInvoice.findFirstOrThrow({ where: { id: ing.invoiceId } }));
    expect(inv.status).toBe('APPROVED');
  });

  it('bloqueia publicação de documento sem conta vinculada', async () => {
    const d = await doc();
    const ing = await inTenant(tenantB, () => ingest.ingest(tenantB, d, null));
    expect(ing.accountMatch?.linkedAccountId).toBeNull(); // tenant B não tem conta com este CNPJ
    await inTenant(tenantB, () => publication.applyBonus(tenantB, ing.invoiceId, { hasBonus: true, bonusAmount: money('40'), rule: 'PROPORTIONAL' }, { sub: 'u1' }));
    await expect(inTenant(tenantB, () => publication.publishCosts(tenantB, ing.invoiceId, { sub: 'u1' }))).rejects.toThrow();
    const costs = await inTenant(tenantB, () => db.productCost.count({ where: { tenantId: tenantB } }));
    expect(costs).toBe(0);
  });

  it('bloqueia segundo publish do mesmo documento (idempotência)', async () => {
    const inv = await inTenant(tenantA, () => db.purchaseInvoice.findFirstOrThrow({ where: { tenantId: tenantA } }));
    await expect(inTenant(tenantA, () => publication.publishCosts(tenantA, inv.id, { sub: 'u1' }))).rejects.toThrow();
    const costs = await inTenant(tenantA, () => db.productCost.count({ where: { tenantId: tenantA } }));
    expect(costs).toBe(2);
  });
});
