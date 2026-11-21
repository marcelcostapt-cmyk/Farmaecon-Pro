import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AgentsService, STALE_RUN_MESSAGE, STALE_RUN_MS } from './agents.service';

const TENANT = 'tenant-a';
const ACCOUNT = { id: 'acc-1', name: 'ML #1', displayName: 'Loja Central', status: 'ACTIVE' as const };

function makePrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    marketplaceAccount: { findFirst: jest.fn().mockResolvedValue(ACCOUNT) },
    agentRun: {
      create: jest.fn(async ({ data }) => ({ id: 'run-1', startedAt: new Date('2026-11-21T10:00:00Z'), finishedAt: null, errorMessage: null, blockReason: null, result: null, ...data, marketplaceAccountId: data.marketplaceAccountId })),
      update: jest.fn(async ({ data }) => ({ id: 'run-1', agentKey: 'central-farma', marketplaceAccountId: ACCOUNT.id, startedAt: new Date('2026-11-21T10:00:00Z'), errorMessage: null, blockReason: null, result: null, status: 'RUNNING', ...data })),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    order: { count: jest.fn().mockResolvedValue(3) },
    productCost: { count: jest.fn().mockResolvedValue(2) },
    marginRule: { count: jest.fn().mockResolvedValue(1) },
    ...overrides,
  };
  return prisma;
}

function makeAds(overrides: Record<string, unknown> = {}) {
  return {
    profile: jest.fn().mockResolvedValue({ rows: 0, firstDay: null, lastDay: null, importBatches: 0, total: new Prisma.Decimal(0), unallocated: new Prisma.Decimal(0), bySku: [], byCampaign: [] }),
    ...overrides,
  };
}

function makeMargin(overrides: Record<string, unknown> = {}) {
  return {
    preview: jest.fn().mockResolvedValue({ group_by: 'sku', lines: [], totals: { revenue: new Prisma.Decimal(0), groupsAvailable: 0, groupsUnavailable: 0 } }),
    alerts: jest.fn().mockResolvedValue([]),
    feeChanges: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('AgentsService — execução da Central Farma', () => {
  it('conta de outro tenant (ou inexistente) é recusada sem criar execução', async () => {
    const prisma = makePrisma({ marketplaceAccount: { findFirst: jest.fn().mockResolvedValue(null) } });
    const service = new AgentsService(prisma as any, makeMargin() as any, makeAds() as any);
    await expect(service.run(TENANT, 'user-1', 'central-farma', 'acc-outro')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.marketplaceAccount.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'acc-outro', tenantId: TENANT } }));
    expect(prisma.agentRun.create).not.toHaveBeenCalled();
  });

  it('agente ainda não implementado (Criativo) não executa e não regista nada', async () => {
    const prisma = makePrisma();
    const service = new AgentsService(prisma as any, makeMargin() as any, makeAds() as any);
    await expect(service.run(TENANT, 'user-1', 'criativo', ACCOUNT.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.agentRun.create).not.toHaveBeenCalled();
  });

  it('agente desconhecido é recusado', async () => {
    const service = new AgentsService(makePrisma() as any, makeMargin() as any, makeAds() as any);
    await expect(service.run(TENANT, 'user-1', 'inexistente', ACCOUNT.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sem pedidos: regista RUNNING e termina BLOCKED com SEM_PEDIDOS, sem consultar margem', async () => {
    const prisma = makePrisma({ order: { count: jest.fn().mockResolvedValue(0) } });
    const margin = makeMargin();
    const service = new AgentsService(prisma as any, margin as any, makeAds() as any);
    const run = await service.run(TENANT, 'user-1', 'dose-certa', ACCOUNT.id);
    expect(prisma.agentRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: TENANT, marketplaceAccountId: ACCOUNT.id, agentKey: 'dose-certa', status: 'RUNNING', requestedBy: 'user-1' }),
    });
    expect(margin.preview).not.toHaveBeenCalled();
    const finalWrite = prisma.agentRun.update.mock.calls.at(-1)![0];
    expect(finalWrite.data).toMatchObject({ status: 'BLOCKED', blockReason: 'SEM_PEDIDOS' });
    expect(finalWrite.data.finishedAt).toBeInstanceOf(Date);
    expect(run.status).toBe('BLOCKED');
  });

  it('com dependências: lê margem, alertas e taxas filtrados pela conta e grava COMPLETED com fontes', async () => {
    const prisma = makePrisma();
    const margin = makeMargin();
    const service = new AgentsService(prisma as any, margin as any, makeAds() as any);
    await service.run(TENANT, 'user-1', 'dose-certa', ACCOUNT.id);
    expect(margin.preview).toHaveBeenCalledWith(TENANT, { accountId: ACCOUNT.id, groupBy: 'sku' });
    expect(margin.alerts).toHaveBeenCalledWith(TENANT, { accountId: ACCOUNT.id, groupBy: 'sku' });
    expect(margin.feeChanges).toHaveBeenCalledWith(TENANT, { accountId: ACCOUNT.id });
    const finalWrite = prisma.agentRun.update.mock.calls.at(-1)![0];
    expect(finalWrite.data.status).toBe('COMPLETED');
    expect(finalWrite.data.result).toMatchObject({
      status: 'COMPLETED',
      account: { id: ACCOUNT.id, name: 'Loja Central' },
    });
  });

  it('falha interna vira FAILED com mensagem genérica, sem detalhes de base de dados', async () => {
    const prisma = makePrisma();
    const margin = makeMargin({ preview: jest.fn().mockRejectedValue(new Error('relation "secret_table" does not exist')) });
    const service = new AgentsService(prisma as any, margin as any, makeAds() as any);
    const run = await service.run(TENANT, 'user-1', 'dose-certa', ACCOUNT.id);
    const finalWrite = prisma.agentRun.update.mock.calls.at(-1)![0];
    expect(finalWrite.data.status).toBe('FAILED');
    expect(finalWrite.data.errorMessage).not.toMatch(/secret_table|relation/);
    expect(finalWrite.data.errorMessage).toMatch(/A análise falhou/);
    expect(run.status).toBe('FAILED');
  });

  it('o catálogo marca agentes não implementados e não os apresenta como ativos', async () => {
    const service = new AgentsService(makePrisma() as any, makeMargin() as any, makeAds() as any);
    const catalog = await service.listCatalog(TENANT);
    const notImplemented = catalog.filter((a) => !a.implemented);
    expect(notImplemented.length).toBeGreaterThan(0);
    for (const agent of notImplemented) expect(agent.latestRun).toBeNull();
    expect(catalog.find((a) => a.key === 'central-farma')?.implemented).toBe(true);
  });

  it('listagem e leitura de execuções sempre filtram pelo tenant', async () => {
    const prisma = makePrisma();
    const service = new AgentsService(prisma as any, makeMargin() as any, makeAds() as any);
    await service.listRuns(TENANT, { limit: 5, agentKey: 'central-farma' });
    expect(prisma.agentRun.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: TENANT, agentKey: 'central-farma' });
    await expect(service.getRun(TENANT, 'run-de-outro')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.agentRun.findFirst).toHaveBeenCalledWith({ where: { id: 'run-de-outro', tenantId: TENANT } });
  });

  it('recuperação: RUNNING antigo vira FAILED, dentro do tenant e sem apagar nada', async () => {
    const prisma = makePrisma();
    prisma.agentRun.updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const service = new AgentsService(prisma as any, makeMargin() as any, makeAds() as any);
    const now = new Date('2026-11-21T12:00:00Z');
    const count = await service.recoverStaleRuns(TENANT, { agentKey: 'central-farma' }, now);
    expect(count).toBe(2);
    const call = prisma.agentRun.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: TENANT, status: 'RUNNING', agentKey: 'central-farma' });
    expect(call.where.startedAt.lt.getTime()).toBe(now.getTime() - STALE_RUN_MS);
    expect(call.data).toMatchObject({ status: 'FAILED', errorMessage: STALE_RUN_MESSAGE, finishedAt: now });
    expect(prisma.agentRun).not.toHaveProperty('delete');
  });

  it('run() antes de criar uma execução recupera apenas RUNNING antigo da mesma conta', async () => {
    const prisma = makePrisma();
    prisma.agentRun.updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const service = new AgentsService(prisma as any, makeMargin() as any, makeAds() as any);
    await service.run(TENANT, 'user-1', 'central-farma', ACCOUNT.id);
    const call = prisma.agentRun.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: TENANT, marketplaceAccountId: ACCOUNT.id, agentKey: 'central-farma', status: 'RUNNING' });
  });

  it('execução recente (dentro do limite) não é tocada', async () => {
    const prisma = makePrisma();
    prisma.agentRun.updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const service = new AgentsService(prisma as any, makeMargin() as any, makeAds() as any);
    const now = new Date('2026-11-21T12:00:00Z');
    await service.recoverStaleRuns(TENANT, {}, now);
    const cutoff = prisma.agentRun.updateMany.mock.calls[0][0].where.startedAt.lt;
    expect(now.getTime() - cutoff.getTime()).toBe(STALE_RUN_MS);
  });

  it('catálogo da conta escolhida usa só execuções dessa conta', async () => {
    const prisma = makePrisma();
    const service = new AgentsService(prisma as any, makeMargin() as any, makeAds() as any);
    await service.listCatalog(TENANT, ACCOUNT.id);
    const where = prisma.agentRun.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: TENANT, marketplaceAccountId: ACCOUNT.id });
  });

  it('Gestor só consolida o resultado persistido do Analista (não recalcula margem)', async () => {
    const prisma = makePrisma();
    const margin = makeMargin();
    const persisted = { agentKey: 'dose-certa', summary: { skusAnalysed: 1 }, findings: [{ id: 'cobertura', severity: 'info', title: 'ok' }], recommendations: [] };
    prisma.agentRun.findFirst = jest.fn(async ({ where }) =>
      where.agentKey === 'dose-certa'
        ? { id: 'run-a', status: 'COMPLETED', startedAt: new Date('2026-11-21T10:00:00Z'), blockReason: null, errorMessage: null, result: persisted }
        : null,
    );
    const service = new AgentsService(prisma as any, margin as any, makeAds() as any);
    await service.run(TENANT, 'user-1', 'central-farma', ACCOUNT.id);
    expect(margin.preview).not.toHaveBeenCalled();
    const gestorResult = prisma.agentRun.update.mock.calls.at(-1)![0].data.result;
    expect(gestorResult.agentKey).toBe('central-farma');
    expect(gestorResult.summary).toEqual(persisted.summary);
    expect(gestorResult.findings).toEqual(persisted.findings);
    expect(gestorResult.consolidation.responsavelCalculo).toBe('dose-certa');
  });

  it('Gestor sem nenhum resultado concluído fica BLOCKED (SEM_RESULTADOS), sem números', async () => {
    const prisma = makePrisma();
    const service = new AgentsService(prisma as any, makeMargin() as any, makeAds() as any);
    const run = await service.run(TENANT, 'user-1', 'central-farma', ACCOUNT.id);
    expect(run.status).toBe('BLOCKED');
    const result = prisma.agentRun.update.mock.calls.at(-1)![0].data.result;
    expect(result).toMatchObject({ blockReason: 'SEM_RESULTADOS', summary: null, findings: [] });
  });

  it('Giro Ads sem importação: BLOCKED SEM_DADOS_ADS, sem investimento inventado', async () => {
    const prisma = makePrisma();
    const service = new AgentsService(prisma as any, makeMargin() as any, makeAds() as any);
    const run = await service.run(TENANT, 'user-1', 'giro-ads', ACCOUNT.id);
    expect(run.status).toBe('BLOCKED');
    expect(prisma.agentRun.update.mock.calls.at(-1)![0].data).toMatchObject({ status: 'BLOCKED', blockReason: 'SEM_DADOS_ADS' });
  });

  it('Giro Ads executa com perfil real e cruza com o último Analista persistido', async () => {
    const prisma = makePrisma();
    prisma.agentRun.findFirst = jest.fn(async ({ where }) =>
      where.agentKey === 'dose-certa'
        ? { id: 'run-a', status: 'COMPLETED', startedAt: new Date('2026-11-21T10:00:00Z'), result: { findings: [{ id: 'alerta-1', severity: 'risco', title: 'x', evidence: { sku: 'SKU-B' } }] } }
        : null,
    );
    const ads = makeAds({
      profile: jest.fn().mockResolvedValue({ rows: 2, firstDay: '2026-11-10', lastDay: '2026-11-11', importBatches: 1, total: new Prisma.Decimal(40), unallocated: new Prisma.Decimal(0), bySku: [{ sku: 'SKU-B', amount: new Prisma.Decimal(40) }], byCampaign: [{ campaign: 'C1', amount: new Prisma.Decimal(40) }] }),
    });
    const service = new AgentsService(prisma as any, makeMargin() as any, ads as any);
    const run = await service.run(TENANT, 'user-1', 'giro-ads', ACCOUNT.id);
    expect(run.status).toBe('COMPLETED');
    expect(ads.profile).toHaveBeenCalledWith(TENANT, ACCOUNT.id);
    const result = prisma.agentRun.update.mock.calls.at(-1)![0].data.result;
    expect(result.agentKey).toBe('giro-ads');
    expect(result.metrics).toMatchObject({ investimento: '40.00', roas: null, acos: null });
    expect(result.findings.some((f: { severity: string; evidence: { sku?: string } }) => f.severity === 'risco' && f.evidence.sku === 'SKU-B')).toBe(true);
  });
});
