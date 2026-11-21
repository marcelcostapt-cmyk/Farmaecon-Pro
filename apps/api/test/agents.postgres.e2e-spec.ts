import { Test } from '@nestjs/testing';
import { Global, Module, INestApplication, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { inTenant } from '../src/shared/prisma/tenant-context';
import { MarginService } from '../src/modules/margin/margin.service';
import { STALE_RUN_MESSAGE, STALE_RUN_MS } from '../src/modules/agents/agents.service';
import { AgentsService } from '../src/modules/agents/agents.service';
import { money } from '../src/modules/costs/cost-money';

// Prova em PostgreSQL REAL da Central Farma: execução COMPLETED com dados reais, BLOCKED por
// dependência (sem pedidos), persistência em agent_runs (RLS) e isolamento entre tenants.

@Global()
@Module({ providers: [PrismaService, MarginService, AgentsService], exports: [PrismaService, MarginService, AgentsService] })
class TestDatabase {}

describe('Escritório de agentes — Central Farma em PostgreSQL real', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agents: AgentsService;
  let margin: MarginService;
  const prefix = `agents-${randomUUID()}`;
  const tenantA = `${prefix}-a`; // com dados
  const tenantB = `${prefix}-b`; // conta sem pedidos
  const tenantC = `${prefix}-c`; // tenant alheio
  const accountA = `${prefix}-accA`;
  const accountB = `${prefix}-accB`;
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

  async function seedSale(tenantId: string, accountId: string, sku: string, qty: number, unitPrice: string, saleFee: string | null) {
    const order = await owner.order.create({
      data: {
        tenantId, marketplaceAccountId: accountId, externalOrderId: `${sku}-${randomUUID()}`,
        totalAmount: qty * Number(unitPrice), status: 'PAID', mlDateCreated: soldAt,
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
    agents = module.get(AgentsService);
    margin = module.get(MarginService);

    for (const id of [tenantA, tenantB, tenantC]) await owner.tenant.create({ data: { id, name: id } });
    await owner.marketplaceAccount.create({
      data: { id: accountA, tenantId: tenantA, platform: 'MERCADO_LIVRE', name: 'ML #agentes-a', source: 'SIMULATED', status: 'ACTIVE' },
    });
    await owner.marketplaceAccount.create({
      data: { id: accountB, tenantId: tenantB, platform: 'MERCADO_LIVRE', name: 'ML #agentes-b', source: 'SIMULATED', status: 'ACTIVE' },
    });
    // SKU ABC: custo 30 × 2, venda 2×50, taxa 10 → margem 30 (30%), abaixo do limite 40%.
    await seedApprovedCost(tenantA, accountA, 'ABC', '30');
    await seedSale(tenantA, accountA, 'ABC', 2, '50', '10');
    // SKU XYZ: custo 45, venda 50, taxa 10 → margem −5 (−10%), sem limite.
    await seedApprovedCost(tenantA, accountA, 'XYZ', '45');
    await seedSale(tenantA, accountA, 'XYZ', 1, '50', '10');
    // SKU SEMTAXA: venda sem saleFee → indisponível (sem taxa).
    await seedSale(tenantA, accountA, 'SEMTAXA', 1, '40', null);
    await owner.marginRule.create({ data: { tenantId: tenantA, sku: 'ABC', minMarginPercent: money('40') } });
    // tenantB: conta ativa sem pedidos → bloqueio por dependência.
  });

  afterAll(async () => {
    const tenants = { in: [tenantA, tenantB, tenantC] };
    await owner?.agentRun.deleteMany({ where: { tenantId: tenants } });
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

  it('conta com dados: execução COMPLETED com margem real, alerta e fontes, persistida', async () => {
    const run = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'central-farma', accountA));
    expect(run.status).toBe('COMPLETED');
    expect(run.result).toMatchObject({
      status: 'COMPLETED',
      account: { id: accountA },
      summary: { skusAnalysed: 3, skusAvailable: 2, skusUnavailable: 1, alertsBelowLimit: 1, unavailableBy: { semTaxa: 1, semCustoPublicado: 0, custoNaoAprovado: 0 } },
    });
    const sources = (run.result as { sources: Array<{ name: string; count: number }> }).sources;
    expect(sources.find((s) => s.name === 'product_costs')?.count).toBe(2);
    expect(sources.find((s) => s.name === 'orders')?.count).toBe(3);

    const persisted = await owner.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(persisted.status).toBe('COMPLETED');
    expect(persisted.tenantId).toBe(tenantA);
    expect(persisted.requestedBy).toBe('user-a');
    expect(persisted.finishedAt).not.toBeNull();
  });

  it('conta sem pedidos: execução BLOCKED com SEM_PEDIDOS, sem números de margem', async () => {
    const run = await inTenant(tenantB, () => agents.run(tenantB, 'user-b', 'central-farma', accountB));
    expect(run.status).toBe('BLOCKED');
    expect(run.blockReason).toBe('SEM_PEDIDOS');
    expect(run.result).toMatchObject({ status: 'BLOCKED', blockReason: 'SEM_PEDIDOS', summary: { skusAnalysed: 0 } });
  });

  it('tenant alheio não executa agente sobre conta de outro tenant', async () => {
    await expect(inTenant(tenantC, () => agents.run(tenantC, 'user-c', 'central-farma', accountA))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tenant alheio não lê execuções de outro tenant e a listagem fica isolada', async () => {
    const runA = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'central-farma', accountA));
    await expect(inTenant(tenantC, () => agents.getRun(tenantC, runA.id))).rejects.toBeInstanceOf(NotFoundException);
    const listC = await inTenant(tenantC, () => agents.listRuns(tenantC, { limit: 20 }));
    expect(listC).toEqual([]);
    const listA = await inTenant(tenantA, () => agents.listRuns(tenantA, { limit: 20, agentKey: 'central-farma' }));
    expect(listA.every((r) => r.accountId === accountA)).toBe(true);
    expect(listA.map((r) => r.id)).toContain(runA.id);
  });

  it('catálogo: a Central Farma tem última execução; agentes não implementados continuam sem execução', async () => {
    const catalog = await inTenant(tenantB, () => agents.listCatalog(tenantB));
    expect(catalog.find((a) => a.key === 'central-farma')?.latestRun?.status).toBe('BLOCKED');
    expect(catalog.filter((a) => !a.implemented).every((a) => a.latestRun === null)).toBe(true);
  });

  it('RUNNING antigo é fechado como FAILED ao consultar; RUNNING recente não é tocado', async () => {
    const old = await owner.agentRun.create({
      data: { tenantId: tenantA, marketplaceAccountId: accountA, agentKey: 'central-farma', status: 'RUNNING', startedAt: new Date(Date.now() - STALE_RUN_MS - 60_000) },
    });
    const fresh = await owner.agentRun.create({
      data: { tenantId: tenantA, marketplaceAccountId: accountA, agentKey: 'central-farma', status: 'RUNNING', startedAt: new Date() },
    });
    const recovered = await inTenant(tenantA, () => agents.getRun(tenantA, old.id));
    expect(recovered.status).toBe('FAILED');
    expect(recovered.errorMessage).toBe(STALE_RUN_MESSAGE);
    expect(recovered.finishedAt).not.toBeNull();
    const stillRunning = await owner.agentRun.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(stillRunning.status).toBe('RUNNING');
  });

  it('tenant alheio não consegue fechar nem ver execução RUNNING antiga de outro tenant', async () => {
    const old = await owner.agentRun.create({
      data: { tenantId: tenantA, marketplaceAccountId: accountA, agentKey: 'central-farma', status: 'RUNNING', startedAt: new Date(Date.now() - STALE_RUN_MS - 60_000) },
    });
    await inTenant(tenantC, () => agents.recoverStaleRuns(tenantC));
    const row = await owner.agentRun.findUniqueOrThrow({ where: { id: old.id } });
    expect(row.status).toBe('RUNNING');
    await expect(inTenant(tenantC, () => agents.getRun(tenantC, old.id))).rejects.toBeInstanceOf(NotFoundException);
    await owner.agentRun.delete({ where: { id: old.id } });
  });

  it('falha real da análise persiste FAILED com mensagem genérica (sem detalhe interno)', async () => {
    const spy = jest.spyOn(margin, 'preview').mockRejectedValueOnce(new Error('connection to db.internal refused'));
    try {
      const run = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'central-farma', accountA));
      expect(run.status).toBe('FAILED');
      expect(run.errorMessage).not.toMatch(/db\.internal|refused/);
      const persisted = await owner.agentRun.findUniqueOrThrow({ where: { id: run.id } });
      expect(persisted.status).toBe('FAILED');
      expect(persisted.errorMessage).toBe(run.errorMessage);
    } finally {
      spy.mockRestore();
    }
  });

  it('isolamento de conta: margem e execuções pedidas com conta de outro tenant ficam vazias', async () => {
    const preview = await inTenant(tenantC, () => margin.preview(tenantC, { accountId: accountA, groupBy: 'sku' }));
    expect(preview.lines).toEqual([]);
    const alerts = await inTenant(tenantC, () => margin.alerts(tenantC, { accountId: accountA, groupBy: 'sku' }));
    expect(alerts).toEqual([]);
    const runsOfA = await inTenant(tenantC, () => agents.listRuns(tenantC, { limit: 20, accountId: accountA }));
    expect(runsOfA).toEqual([]);
  });
});
