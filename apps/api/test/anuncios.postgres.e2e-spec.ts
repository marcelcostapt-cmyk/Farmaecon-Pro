import { Test } from '@nestjs/testing';
import { Global, Module, INestApplication, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { inTenant } from '../src/shared/prisma/tenant-context';
import { MarginService } from '../src/modules/margin/margin.service';
import { AdsService } from '../src/modules/ads/ads.service';
import { AgentsService } from '../src/modules/agents/agents.service';
import { money } from '../src/modules/costs/cost-money';

// ANÚNCIOS (Vitrine Farma) em PostgreSQL real: qualidade do catálogo local dos SKUs vendidos pela conta,
// separação entre contas da mesma empresa, isolamento entre empresas, custo só da publicação aprovada,
// e consolidação pelo Gestor. Dados sintéticos; nenhuma chamada ao Mercado Livre.

@Global()
@Module({ providers: [PrismaService, MarginService, AdsService, AgentsService], exports: [PrismaService, MarginService, AdsService, AgentsService] })
class TestDatabase {}

describe('Anúncios (Vitrine Farma) — catálogo local em PostgreSQL real', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agents: AgentsService;
  const prefix = `anu-${randomUUID()}`;
  const tenantA = `${prefix}-a`;
  const tenantB = `${prefix}-b`;
  const tenantC = `${prefix}-c`;
  const acc1 = randomUUID();
  const acc2 = randomUUID();
  const accB = randomUUID();
  const soldAt = new Date('2026-05-10T12:00:00Z');

  async function seedCost(tenantId: string, accountId: string, sku: string, unit: string) {
    const inv = await owner.purchaseInvoice.create({
      data: { tenantId, marketplaceAccountId: accountId, source: 'XML', originalFilename: `${sku}.xml`, fileHashSha256: `${sku}-${tenantId}-${accountId}`, status: 'APPROVED' },
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

  async function seedSale(tenantId: string, accountId: string, sku: string, qty: number) {
    const order = await owner.order.create({
      data: { tenantId, marketplaceAccountId: accountId, externalOrderId: `${sku}-${randomUUID()}`, totalAmount: qty * 10, status: 'PAID', mlDateCreated: soldAt },
      select: { id: true },
    });
    await owner.orderItem.create({
      data: { tenantId, marketplaceAccountId: accountId, orderId: order.id, mlElementId: randomUUID(), sellerSkuRaw: sku, title: `Produto ${sku}`, quantity: qty, unitPrice: money('10'), saleFee: money('1') },
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
    for (const [id, tenant] of [[acc1, tenantA], [acc2, tenantA], [accB, tenantB], [randomUUID(), tenantC]] as const) {
      await owner.marketplaceAccount.create({ data: { id, tenantId: tenant, platform: 'MERCADO_LIVRE', name: `ML ${id.slice(0, 6)}`, source: 'SIMULATED', status: 'ACTIVE' } });
    }
    // Cadastro da empresa A. SKU-2 tem cost_price legado (999) que NÃO pode ser usado.
    const prod = (sku: string, over: Record<string, unknown>) => owner.product.create({
      data: { tenantId: tenantA, sku, title: `Produto completo ${sku}`, costPrice: 0, basePrice: 50, stockQuantity: 5, minStockQuantity: 2, anvisaRegister: 'REG-1', ...over },
    });
    await prod('SKU-1', { stockQuantity: 0 });
    await prod('SKU-2', { title: 'ab', basePrice: 10, anvisaRegister: null, costPrice: 999 });
    await prod('SKU-9', { title: 'Produto só da conta 2' });
    await prod('SKU-7', { title: 'Produto nunca vendido' });
    await owner.product.create({ data: { tenantId: tenantB, sku: 'SKU-1', title: 'Produto da outra empresa', costPrice: 0, basePrice: 1, stockQuantity: 0, minStockQuantity: 0 } });
    // Vendas: conta 1 vende SKU-1, SKU-2 e SKU-3 (sem cadastro); conta 2 vende SKU-9.
    await seedSale(tenantA, acc1, 'SKU-1', 2);
    await seedSale(tenantA, acc1, 'SKU-2', 1);
    await seedSale(tenantA, acc1, 'SKU-3', 4);
    await seedSale(tenantA, acc2, 'SKU-9', 1);
    // Custos aprovados: SKU-2 custa 20 na conta 1 (preço-base 10 → abaixo do custo); SKU-1 sem custo.
    await seedCost(tenantA, acc1, 'SKU-2', '20');
    await seedCost(tenantB, accB, 'SKU-1', '5');
  });

  afterAll(async () => {
    const tenants = { in: [tenantA, tenantB, tenantC] };
    await owner?.agentRun.deleteMany({ where: { tenantId: tenants } });
    await owner?.orderItem.deleteMany({ where: { tenantId: tenants } });
    await owner?.order.deleteMany({ where: { tenantId: tenants } });
    await owner?.productCost.deleteMany({ where: { tenantId: tenants } });
    await owner?.costAllocationRule.deleteMany({ where: { tenantId: tenants } });
    await owner?.purchaseInvoice.deleteMany({ where: { tenantId: tenants } });
    await owner?.product.deleteMany({ where: { tenantId: tenants } });
    await owner?.marketplaceAccount.deleteMany({ where: { tenantId: tenants } });
    await owner?.tenant.deleteMany({ where: { id: tenants } });
    await owner?.$disconnect();
    await app?.close();
  });

  it('conta 1: qualidade do catálogo dos SKUs que ela vendeu, com as regras e evidências', async () => {
    const run = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'vitrine-farma', acc1));
    expect(run.status).toBe('COMPLETED');
    const r = run.result as { summary: Record<string, number>; findings: Array<{ id: string; severity: string; evidence: Record<string, unknown> }> };
    expect(r.summary).toMatchObject({ skusVendidos: 3, comCadastro: 2, semCadastro: 1, comCustoAprovado: 1, unidadesVendidas: 7 });
    const byId = (id: string) => r.findings.find((f) => f.id === id);
    expect(byId('sem-cadastro')?.evidence).toMatchObject({ skus: ['SKU-3'] });
    expect(byId('ruptura-com-venda')?.evidence).toMatchObject({ skus: ['SKU-1'] });
    expect(byId('titulo-incompleto')?.evidence).toMatchObject({ skus: ['SKU-2'] });
    expect(byId('anvisa-ausente')?.evidence).toMatchObject({ skus: ['SKU-2'] });
    expect(byId('preco-abaixo-custo-1')?.evidence).toMatchObject({ sku: 'SKU-2', precoBase: '10.00', custoAprovado: '20.00' });
    expect(byId('sem-custo-publicado')?.evidence).toMatchObject({ skus: ['SKU-1', 'SKU-3'] });
  });

  it('separação entre contas: SKU vendido só pela conta 2 não aparece na conta 1 e vice-versa', async () => {
    const r1 = JSON.stringify((await inTenant(tenantA, () => agents.listRuns(tenantA, { limit: 10, agentKey: 'vitrine-farma', accountId: acc1 }))));
    expect(r1).toBeDefined();
    const run1 = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'vitrine-farma', acc1));
    expect(JSON.stringify(run1.result)).not.toMatch(/SKU-9|Produto só da conta 2/);
    const run2 = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'vitrine-farma', acc2));
    expect(run2.status).toBe('COMPLETED');
    expect((run2.result as { summary: Record<string, number> }).summary).toMatchObject({ skusVendidos: 1, comCadastro: 1, comCustoAprovado: 0 });
    expect(JSON.stringify(run2.result)).not.toMatch(/SKU-2|SKU-3|SKU-1/);
  });

  it('o campo legado cost_price não é usado: a evidência de custo vem da publicação aprovada', async () => {
    const run = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'vitrine-farma', acc1));
    expect(JSON.stringify(run.result)).not.toMatch(/"999|999\.00/);
  });

  it('SKU nunca vendido (SKU-7) nunca entra na análise', async () => {
    const run = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'vitrine-farma', acc1));
    expect(JSON.stringify(run.result)).not.toMatch(/SKU-7|nunca vendido/);
  });

  it('isolamento entre empresas: o cadastro da outra empresa com o mesmo SKU nunca é usado', async () => {
    const run = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'vitrine-farma', acc1));
    expect(JSON.stringify(run.result)).not.toMatch(/outra empresa/);
    const runB = await inTenant(tenantB, () => agents.run(tenantB, 'user-b', 'vitrine-farma', accB));
    expect(runB.status).toBe('BLOCKED');
    expect(runB.blockReason).toBe('SEM_VENDAS');
  });

  it('tenant alheio não executa Anúncios sobre conta de outra empresa', async () => {
    await expect(inTenant(tenantC, () => agents.run(tenantC, 'user-c', 'vitrine-farma', acc1))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('persistência: execução do Anúncios fica em agent_runs', async () => {
    const rows = await owner.agentRun.findMany({ where: { tenantId: tenantA, agentKey: 'vitrine-farma', marketplaceAccountId: acc1 } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((x) => x.status === 'COMPLETED')).toBe(true);
  });

  it('Gestor consolida o Anúncios com origem e data, sem recalcular', async () => {
    const gestor = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'central-farma', acc1));
    const mesa = (gestor.result as { consolidation: { mesa: { agentes: Array<{ publicName: string; estado: string; dataExecucao: string | null }> } } }).consolidation.mesa;
    const anuncios = mesa.agentes.find((a) => a.publicName === 'Anúncios');
    expect(anuncios?.estado).toBe('CONCLUIDO');
    expect(anuncios?.dataExecucao).not.toBeNull();
  });
});
