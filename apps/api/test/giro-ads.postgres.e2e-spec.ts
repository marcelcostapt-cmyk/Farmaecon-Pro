import { Test } from '@nestjs/testing';
import { Global, Module, INestApplication, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { inTenant } from '../src/shared/prisma/tenant-context';
import { MarginService } from '../src/modules/margin/margin.service';
import { AdsService } from '../src/modules/ads/ads.service';
import { AgentsService } from '../src/modules/agents/agents.service';
import { money } from '../src/modules/costs/cost-money';

// Prova em PostgreSQL REAL do Giro Ads (ADS) e da integração Gestor + Analista + ADS:
// dados de ADS por conta, separação entre contas, isolamento entre tenants, ausência de dados,
// cruzamento com o Analista persistido e consolidação auditável do Gestor.

@Global()
@Module({ providers: [PrismaService, MarginService, AdsService, AgentsService], exports: [PrismaService, MarginService, AdsService, AgentsService] })
class TestDatabase {}

describe('Giro Ads (ADS) e Gestor — PostgreSQL real', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agents: AgentsService;
  const prefix = `ads-${randomUUID()}`;
  const tenantA = `${prefix}-a`;
  const tenantB = `${prefix}-b`;
  const tenantC = `${prefix}-c`; // tenant alheio
  const acc1 = `${prefix}-acc1`; // com ADS e vendas
  const acc2 = `${prefix}-acc2`; // mesma empresa, sem ADS
  const accB = `${prefix}-accB`; // outra empresa, com ADS grandes
  const accC = `${prefix}-accC`;
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
      data: { tenantId, marketplaceAccountId: accountId, sku, unitCost: money(unit), isEstimate: false, costAllocationRuleId: rule.id, validFrom: new Date('2026-04-01T00:00:00Z'), status: 'APPROVED' },
    });
  }

  async function seedSale(tenantId: string, accountId: string, sku: string, unitPrice: string, saleFee: string) {
    const order = await owner.order.create({
      data: { tenantId, marketplaceAccountId: accountId, externalOrderId: `${sku}-${randomUUID()}`, totalAmount: Number(unitPrice), status: 'PAID', mlDateCreated: soldAt },
      select: { id: true },
    });
    await owner.orderItem.create({
      data: { tenantId, marketplaceAccountId: accountId, orderId: order.id, mlElementId: randomUUID(), sellerSkuRaw: sku, title: `Produto ${sku}`, quantity: 1, unitPrice: money(unitPrice), saleFee: money(saleFee) },
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

    for (const id of [tenantA, tenantB, tenantC]) await owner.tenant.create({ data: { id, name: id } });
    for (const [id, tenant, name] of [
      [acc1, tenantA, 'ML #ads-1'],
      [acc2, tenantA, 'ML #ads-2'],
      [accB, tenantB, 'ML #ads-b'],
      [accC, tenantC, 'ML #ads-c'],
    ] as const) {
      await owner.marketplaceAccount.create({ data: { id, tenantId: tenant, platform: 'MERCADO_LIVRE', name, source: 'SIMULATED', status: 'ACTIVE' } });
    }
    // Analista: SKU-B com margem negativa, SKU-A saudável; limite global 40%.
    await seedApprovedCost(tenantA, acc1, 'SKU-A', '10');
    await seedSale(tenantA, acc1, 'SKU-A', '50', '5');
    await seedApprovedCost(tenantA, acc1, 'SKU-B', '45');
    await seedSale(tenantA, acc1, 'SKU-B', '50', '10');
    await owner.marginRule.create({ data: { tenantId: tenantA, sku: null, minMarginPercent: money('40') } });
    // ADS de acc1: 100 em duas importações; 10 sem SKU; C1 domina.
    await owner.adsCost.createMany({
      data: [
        { tenantId: tenantA, marketplaceAccountId: acc1, day: new Date('2026-11-10'), sku: 'SKU-B', campaign: 'C1', amount: money('40'), sourceHash: 'h1', sourceLine: 1 },
        { tenantId: tenantA, marketplaceAccountId: acc1, day: new Date('2026-11-10'), sku: 'SKU-A', campaign: 'C1', amount: money('30'), sourceHash: 'h1', sourceLine: 2 },
        { tenantId: tenantA, marketplaceAccountId: acc1, day: new Date('2026-11-11'), sku: null, campaign: 'C2', amount: money('10'), sourceHash: 'h2', sourceLine: 1 },
        { tenantId: tenantA, marketplaceAccountId: acc1, day: new Date('2026-11-11'), sku: 'SKU-A', campaign: 'C1', amount: money('20'), sourceHash: 'h2', sourceLine: 2 },
      ],
    });
    // Empresa B: ADS muito maior, que não pode aparecer em A.
    await owner.adsCost.create({ data: { tenantId: tenantB, marketplaceAccountId: accB, day: new Date('2026-11-10'), sku: 'SKU-X', campaign: 'BIG', amount: money('9000'), sourceHash: 'hb', sourceLine: 1 } });
  });

  afterAll(async () => {
    const tenants = { in: [tenantA, tenantB, tenantC] };
    await owner?.agentRun.deleteMany({ where: { tenantId: tenants } });
    await owner?.adsCost.deleteMany({ where: { tenantId: tenants } });
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

  it('Giro Ads: investimento, período e origem reais; ROAS e ACOS indisponíveis (sem vendas atribuídas)', async () => {
    const run = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'giro-ads', acc1));
    expect(run.status).toBe('COMPLETED');
    const r = run.result as { metrics: Record<string, unknown>; period: unknown; origem: unknown; findings: Array<{ id: string }> };
    expect(r.metrics).toMatchObject({ investimento: '100.00', receitaAtribuida: null, roas: null, acos: null });
    expect(r.period).toEqual({ inicio: '2026-11-10', fim: '2026-11-11' });
    expect(r.origem).toMatchObject({ linhasImportadas: 4, ficheirosImportados: 2, fonte: 'ads_costs (CSV importado)' });
    expect(r.findings.map((f) => f.id)).toEqual(expect.arrayContaining(['investimento', 'sem-sku', 'sem-receita-atribuida']));
  });

  it('Giro Ads cruza investimento em SKU com alerta do Analista (dados persistidos, sem recalcular)', async () => {
    await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'dose-certa', acc1));
    const run = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'giro-ads', acc1));
    const r = run.result as { findings: Array<{ severity: string; evidence: { sku?: string } }>; analista: { status: string } };
    expect(r.analista.status).toBe('COMPLETED');
    expect(r.findings.some((f) => f.severity === 'risco' && f.evidence.sku === 'SKU-B')).toBe(true);
    expect(r.findings.some((f) => f.evidence.sku === 'SKU-A' && f.severity === 'risco')).toBe(false);
  });

  it('separação entre contas: conta sem ADS fica BLOCKED e não herda o investimento da outra', async () => {
    const run = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'giro-ads', acc2));
    expect(run.status).toBe('BLOCKED');
    expect(run.blockReason).toBe('SEM_DADOS_ADS');
    expect(run.result).toMatchObject({ metrics: { investimento: null } });
  });

  it('isolamento multiempresa: investimento de outra empresa nunca aparece', async () => {
    const run = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'giro-ads', acc1));
    expect(JSON.stringify(run.result)).not.toMatch(/9000|BIG|SKU-X/);
    const runB = await inTenant(tenantB, () => agents.run(tenantB, 'user-b', 'giro-ads', accB));
    expect((runB.result as { metrics: { investimento: string } }).metrics.investimento).toBe('9000.00');
  });

  it('tenant alheio não executa Giro Ads sobre conta de outra empresa nem lê as execuções', async () => {
    await expect(inTenant(tenantC, () => agents.run(tenantC, 'user-c', 'giro-ads', acc1))).rejects.toBeInstanceOf(NotFoundException);
    const runA = await inTenant(tenantA, () => agents.listRuns(tenantA, { limit: 5, agentKey: 'giro-ads' }));
    await expect(inTenant(tenantC, () => agents.getRun(tenantC, runA[0].id))).rejects.toBeInstanceOf(NotFoundException);
    expect(await inTenant(tenantC, () => agents.listRuns(tenantC, { limit: 5 }))).toEqual([]);
  });

  it('persistência: a execução do Giro Ads fica em agent_runs com o resultado completo', async () => {
    const runs = await owner.agentRun.findMany({ where: { tenantId: tenantA, agentKey: 'giro-ads', marketplaceAccountId: acc1 } });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.every((x) => x.status === 'COMPLETED')).toBe(true);
    expect((runs[0].result as { agentKey: string }).agentKey).toBe('giro-ads');
  });

  it('Gestor consolida Analista e ADS da conta com origem e data, sem recalcular', async () => {
    const gestor = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'central-farma', acc1));
    expect(gestor.status).toBe('COMPLETED');
    const mesa = (gestor.result as { consolidation: { mesa: { temResultados: boolean; agentes: Array<{ publicName: string; estado: string; dataExecucao: string | null }>; prioridades: unknown[] } } }).consolidation.mesa;
    expect(mesa.temResultados).toBe(true);
    expect(mesa.agentes.map((a) => [a.publicName, a.estado])).toEqual([
      ['Analista', 'CONCLUIDO'],
      ['ADS', 'CONCLUIDO'],
    ]);
    expect(mesa.agentes.every((a) => a.dataExecucao !== null)).toBe(true);
    expect(mesa.prioridades.length).toBeGreaterThan(0);
  });

  it('Gestor mostra o estado real de cada agente: conta sem ADS e sem Analista fica BLOCKED, sem resultados inventados', async () => {
    const gestor = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'central-farma', acc2));
    expect(gestor.status).toBe('BLOCKED');
    expect(gestor.blockReason).toBe('SEM_RESULTADOS');
    const mesa = (gestor.result as { consolidation: { mesa: { agentes: Array<{ publicName: string; estado: string }>; pendencias: Array<{ titulo: string }> } } }).consolidation.mesa;
    expect(mesa.agentes.map((a) => [a.publicName, a.estado])).toEqual([
      ['Analista', 'NUNCA_EXECUTADO'],
      ['ADS', 'BLOQUEADO'],
    ]);
    expect(mesa.pendencias.some((p) => /Nunca executado/.test(p.titulo))).toBe(true);
  });

  it('catálogo da conta mostra o Giro Ads como executável e com última execução própria', async () => {
    const catalog = await inTenant(tenantA, () => agents.listCatalog(tenantA, acc2));
    const ads = catalog.find((a) => a.key === 'giro-ads')!;
    expect(ads.implemented).toBe(true);
    expect(ads.latestRun?.status).toBe('BLOCKED');
    const catalogB = await inTenant(tenantB, () => agents.listCatalog(tenantB, acc1));
    expect(catalogB.find((a) => a.key === 'giro-ads')?.latestRun).toBeNull();
  });
});
