import { Test } from '@nestjs/testing';
import { Global, Module, INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { inTenant } from '../src/shared/prisma/tenant-context';
import { MarginService } from '../src/modules/margin/margin.service';
import { money } from '../src/modules/costs/cost-money';

// Prova em PostgreSQL REAL do Gestor de Margem (WeStack): aplica a migration margin_rules
// (+ RLS, boot check 15), semeia venda real (order_items com saleFee) e custo APPROVED,
// e confirma margem líquida + alertas por tenant. Ligação runtime = farmaecon_runtime.

@Global()
@Module({ providers: [PrismaService, MarginService], exports: [PrismaService, MarginService] })
class TestDatabase {}

describe('Gestor de Margem — PostgreSQL real', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let margin: MarginService;
  const prefix = `margin-${randomUUID()}`;
  const tenantA = `${prefix}-a`;
  const tenantB = `${prefix}-b`;
  const tenantC = `${prefix}-c`; // tenant dedicado à mudança de tarifa (não altera os totais de A/B)
  const accountA = `${prefix}-acc`;
  const accountC = `${prefix}-accC`;
  const soldAt = new Date('2026-05-10T12:00:00Z');

  async function seedApprovedCost(tenantId: string, accountId: string, sku: string, unit: string) {
    const inv = await owner.purchaseInvoice.create({
      data: { tenantId, marketplaceAccountId: accountId, source: 'XML', originalFilename: `${sku}.xml`, fileHashSha256: `${sku}-${tenantId}`, status: 'APPROVED' },
      select: { id: true },
    });
    const rule = await owner.costAllocationRule.create({
      data: { tenantId, purchaseInvoiceId: inv.id, ruleType: 'PROPORTIONAL_SPREAD', approvedAt: new Date('2026-04-01T00:00:00Z') },
      select: { id: true },
    });
    await owner.productCost.create({
      data: {
        tenantId, marketplaceAccountId: accountId, sku, unitCost: money(unit), isEstimate: false,
        costAllocationRuleId: rule.id, validFrom: new Date('2026-04-01T00:00:00Z'), status: 'APPROVED',
      },
    });
  }

  async function seedSale(
    tenantId: string,
    accountId: string,
    sku: string,
    qty: number,
    unitPrice: string,
    saleFee: string | null,
    at: Date = soldAt,
  ) {
    const order = await owner.order.create({
      data: {
        tenantId, marketplaceAccountId: accountId, externalOrderId: `${sku}-${randomUUID()}`,
        totalAmount: qty * Number(unitPrice), status: 'PAID', mlDateCreated: at,
      },
      select: { id: true },
    });
    await owner.orderItem.create({
      data: {
        tenantId, marketplaceAccountId: accountId, orderId: order.id, mlElementId: randomUUID(),
        sellerSkuRaw: sku, title: `Produto ${sku}`, quantity: qty, unitPrice: money(unitPrice),
        saleFee: saleFee === null ? null : money(saleFee),
      },
    });
  }

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
    margin = module.get(MarginService);

    for (const id of [tenantA, tenantB, tenantC]) await owner.tenant.create({ data: { id, name: id } });
    await owner.marketplaceAccount.create({
      data: { id: accountA, tenantId: tenantA, platform: 'MERCADO_LIVRE', name: 'ML #pilot', source: 'SIMULATED', status: 'ACTIVE' },
    });
    await owner.marketplaceAccount.create({
      data: { id: accountC, tenantId: tenantC, platform: 'MERCADO_LIVRE', name: 'ML #tarifa', source: 'SIMULATED', status: 'ACTIVE' },
    });
    // Tarifa do SKU TAR sobe de 10% (maio) para 15% (junho) → alerta de mudança de tarifa (Δ +5 pp).
    await seedSale(tenantC, accountC, 'TAR', 1, '100', '10', new Date('2026-05-10T12:00:00Z'));
    await seedSale(tenantC, accountC, 'TAR', 1, '100', '15', new Date('2026-06-10T12:00:00Z'));
    // SKU ABC: custo 30, venda 2×50, taxa 10 → margem 30 (30%). SKU SEMTAXA: sem saleFee → indisponível.
    await seedApprovedCost(tenantA, accountA, 'ABC', '30');
    await seedSale(tenantA, accountA, 'ABC', 2, '50', '10');
    await seedSale(tenantA, accountA, 'SEMTAXA', 1, '40', null);
    // SKU XYZ: custo 45, venda 50, taxa 10 → margem −5 (−10%): vilão do ranking.
    await seedApprovedCost(tenantA, accountA, 'XYZ', '45');
    await seedSale(tenantA, accountA, 'XYZ', 1, '50', '10');
    await owner.marginRule.create({ data: { tenantId: tenantA, sku: 'ABC', minMarginPercent: money('40') } });
  });

  afterAll(async () => {
    const tenants = { in: [tenantA, tenantB, tenantC] };
    await owner?.marginRule.deleteMany({ where: { tenantId: tenants } });
    await owner?.orderItem.deleteMany({ where: { tenantId: tenants } });
    await owner?.order.deleteMany({ where: { tenantId: tenants } });
    await owner?.productCost.deleteMany({ where: { tenantId: tenants } });
    await owner?.costAllocationRule.deleteMany({ where: { tenantId: tenants } });
    await owner?.purchaseInvoice.deleteMany({ where: { tenantId: tenants } });
    await owner?.marketplaceAccount.deleteMany({ where: { tenantId: tenants } });
    await owner?.tenant.deleteMany({ where: { id: tenants } });
    await owner?.$disconnect();
    await app?.close();
  });

  it('calcula margem líquida por SKU quando custo APPROVED e taxa existem', async () => {
    const preview = await inTenant(tenantA, () => margin.preview(tenantA, { groupBy: 'sku' }));
    const abc = preview.lines.find((l) => l.sku === 'ABC')!;
    expect(abc.status).toBe('disponivel');
    expect(abc.revenue.toString()).toBe('100');
    expect(abc.fees!.toString()).toBe('10');
    expect(abc.cost!.toString()).toBe('60');
    expect(abc.margin!.toString()).toBe('30');
    expect(abc.marginPercent!.toString()).toBe('30');
  });

  it('marca indisponível o SKU sem taxa (nunca fabrica número)', async () => {
    const preview = await inTenant(tenantA, () => margin.preview(tenantA, { groupBy: 'sku' }));
    const semTaxa = preview.lines.find((l) => l.sku === 'SEMTAXA')!;
    expect(semTaxa.status).toBe('indisponivel');
    expect(semTaxa.margin).toBeNull();
  });

  it('alerta o SKU abaixo do limite configurado (30% < 40%)', async () => {
    const alerts = await inTenant(tenantA, () => margin.alerts(tenantA, { groupBy: 'sku' }));
    expect(alerts.map((a) => a.sku)).toContain('ABC');
    const abc = alerts.find((a) => a.sku === 'ABC')!;
    expect(abc.marginPercent!.toString()).toBe('30');
    expect(abc.limitPercent!.toString()).toBe('40');
  });

  it('ranking: herói = maior margem %, vilão = menor, indisponível fica de fora e é contado', async () => {
    const ranking = await inTenant(tenantA, () => margin.ranking(tenantA, {}));
    expect(ranking.heroes.map((l) => l.sku)).toEqual(['ABC']);
    expect(ranking.villains.map((l) => l.sku)).toEqual(['XYZ']);
    expect(ranking.villains[0].marginPercent!.toString()).toBe('-10');
    expect(ranking.unavailableCount).toBe(1); // SEMTAXA
  });

  it('mudança de tarifa ML: alerta o SKU cuja taxa efetiva varia ≥ 2 pp entre meses', async () => {
    const changes = await inTenant(tenantC, () => margin.feeChanges(tenantC, {}));
    expect(changes).toHaveLength(1);
    expect(changes[0].sku).toBe('TAR');
    expect(changes[0].fromMonth).toBe('2026-05');
    expect(changes[0].toMonth).toBe('2026-06');
    expect(changes[0].deltaPp.toString()).toBe('5');
  });

  it('isola por tenant: tenant B não vê vendas nem alertas de A', async () => {
    const preview = await inTenant(tenantB, () => margin.preview(tenantB, { groupBy: 'sku' }));
    expect(preview.lines).toHaveLength(0);
    const alerts = await inTenant(tenantB, () => margin.alerts(tenantB, { groupBy: 'sku' }));
    expect(alerts).toHaveLength(0);
    const ranking = await inTenant(tenantB, () => margin.ranking(tenantB, {}));
    expect(ranking.heroes).toHaveLength(0);
    expect(ranking.villains).toHaveLength(0);
    expect(ranking.unavailableCount).toBe(0);
  });
});
