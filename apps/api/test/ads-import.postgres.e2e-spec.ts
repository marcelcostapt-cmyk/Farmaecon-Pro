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
import { parseAdsCsv } from '../src/modules/costs/ads-csv';

// Importação de CSV de ADS em PostgreSQL REAL: pré-visualização sem gravar, importação, reimportação
// sem duplicar, aviso de ficheiro re-exportado, isolamento por tenant e conta, e Giro Ads depois da importação.
// Dados sintéticos isolados; nenhum ficheiro sai do servidor.

@Global()
@Module({ providers: [PrismaService, MarginService, AdsService, AgentsService], exports: [PrismaService, MarginService, AdsService, AgentsService] })
class TestDatabase {}

const FILE_V1 = 'data;valor;sku;campanha\n2026-11-10;30,00;SKU-A;"Black; Friday"\n2026-11-10;20,00;;C2\n2026-11-11;50,50;SKU-A;"Oferta ""Verão"""\n';
// Mesmas linhas, outra formatação (CRLF e data BR): outro hash, mesmo conteúdo.
const FILE_V1_REEXPORT = 'data;valor;sku;campanha\r\n10/11/2026;30,00;SKU-A;"Black; Friday"\r\n10/11/2026;20,00;;C2\r\n11/11/2026;50,50;SKU-A;"Oferta ""Verão"""\r\n';

function hash(text: string) {
  return require('node:crypto').createHash('sha256').update(text, 'utf8').digest('hex');
}

describe('ADS — importação de CSV em PostgreSQL real', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let ads: AdsService;
  let agents: AgentsService;
  const prefix = `adsimp-${randomUUID()}`;
  const tenantA = `${prefix}-a`;
  const tenantB = `${prefix}-b`;
  const acc1 = randomUUID();
  const acc2 = randomUUID();
  const accB = randomUUID();

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
    agents = module.get(AgentsService);
    for (const id of [tenantA, tenantB]) await owner.tenant.create({ data: { id, name: id } });
    for (const [id, tenant] of [[acc1, tenantA], [acc2, tenantA], [accB, tenantB]] as const) {
      await owner.marketplaceAccount.create({ data: { id, tenantId: tenant, platform: 'MERCADO_LIVRE', name: `ML ${id.slice(0, 6)}`, source: 'SIMULATED', status: 'ACTIVE' } });
    }
  });

  afterAll(async () => {
    const tenants = { in: [tenantA, tenantB] };
    await owner?.agentRun.deleteMany({ where: { tenantId: tenants } });
    await owner?.adsCost.deleteMany({ where: { tenantId: tenants } });
    await owner?.marketplaceAccount.deleteMany({ where: { tenantId: tenants } });
    await owner?.tenant.deleteMany({ where: { id: tenants } });
    await owner?.$disconnect();
    await app?.close();
  });

  it('pré-visualização não grava nada; importação grava as linhas e o resumo confere com o ficheiro', async () => {
    const before = await owner.adsCost.count({ where: { tenantId: tenantA } });
    const pv = await inTenant(tenantA, () => ads.preview(tenantA, acc1, FILE_V1, hash(FILE_V1)));
    expect(pv.valid).toBe(true);
    expect(await owner.adsCost.count({ where: { tenantId: tenantA } })).toBe(before);
    expect(pv.summary?.total.toString()).toBe('100.5');

    const result = await inTenant(tenantA, () => ads.importCsv(tenantA, acc1, FILE_V1, hash(FILE_V1)));
    expect(result).toEqual({ received: 3, imported: 3, skipped: 0 });
    const rows = await owner.adsCost.findMany({ where: { tenantId: tenantA, marketplaceAccountId: acc1 }, orderBy: { sourceLine: 'asc' } });
    expect(rows.map((r) => [r.sku, r.campaign, r.amount.toString()])).toEqual([
      ['SKU-A', 'Black; Friday', '30'],
      [null, 'C2', '20'],
      ['SKU-A', 'Oferta "Verão"', '50.5'],
    ]);
  });

  it('reimportar o mesmo ficheiro não duplica despesas', async () => {
    const pv = await inTenant(tenantA, () => ads.preview(tenantA, acc1, FILE_V1, hash(FILE_V1)));
    expect(pv.alreadyImported).toBe(true);
    expect(pv.warnings.join(' ')).toMatch(/Nenhuma linha será duplicada/);
    const again = await inTenant(tenantA, () => ads.importCsv(tenantA, acc1, FILE_V1, hash(FILE_V1)));
    expect(again).toEqual({ received: 3, imported: 0, skipped: 3 });
    expect(await owner.adsCost.count({ where: { tenantId: tenantA, marketplaceAccountId: acc1 } })).toBe(3);
  });

  it('ficheiro re-exportado (outro hash, mesmo conteúdo) é avisado como possível duplicação', async () => {
    const parsed = parseAdsCsv(FILE_V1_REEXPORT);
    expect(parsed.errors).toEqual([]);
    const pv = await inTenant(tenantA, () => ads.preview(tenantA, acc1, FILE_V1_REEXPORT, hash(FILE_V1_REEXPORT)));
    expect(pv.alreadyImported).toBe(false);
    expect(pv.overlappingRows).toBeGreaterThan(0);
    expect(pv.warnings.join(' ')).toMatch(/possível duplicação|re-exportada/);
  });

  it('separação entre contas: a outra conta da mesma empresa começa vazia', async () => {
    const overview = await inTenant(tenantA, () => ads.profile(tenantA, acc2));
    expect(overview.rows).toBe(0);
    expect(overview.total.toString()).toBe('0');
    expect(await owner.adsCost.count({ where: { tenantId: tenantA, marketplaceAccountId: acc2 } })).toBe(0);
  });

  it('isolamento por tenant: outra empresa não pré-visualiza, não importa nem lê a conta', async () => {
    await expect(inTenant(tenantB, () => ads.preview(tenantB, acc1, FILE_V1, hash(FILE_V1)))).rejects.toBeInstanceOf(NotFoundException);
    await expect(inTenant(tenantB, () => ads.importCsv(tenantB, acc1, FILE_V1, hash(FILE_V1)))).rejects.toBeInstanceOf(NotFoundException);
    const bProfile = await inTenant(tenantB, () => ads.profile(tenantB, acc1));
    expect(bProfile.rows).toBe(0);
    expect(await owner.adsCost.count({ where: { tenantId: tenantB } })).toBe(0);
  });

  it('indicadores da conta refletem a importação concluída', async () => {
    const p = await inTenant(tenantA, () => ads.profile(tenantA, acc1));
    expect(p).toMatchObject({ rows: 3, firstDay: '2026-11-10', lastDay: '2026-11-11', importBatches: 1 });
    expect(p.total.toString()).toBe('100.5');
    expect(p.unallocated.toString()).toBe('20');
  });

  it('Giro Ads executa depois da importação e usa o investimento importado (sem ROAS inventado)', async () => {
    const run = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'giro-ads', acc1));
    expect(run.status).toBe('COMPLETED');
    const r = run.result as { metrics: Record<string, unknown>; origem: { linhasImportadas: number } };
    expect(r.metrics).toMatchObject({ investimento: '100.50', roas: null, acos: null, receitaAtribuida: null });
    expect(r.origem.linhasImportadas).toBe(3);
  });

  it('Gestor consolida a execução do ADS sem recalcular', async () => {
    const gestor = await inTenant(tenantA, () => agents.run(tenantA, 'user-a', 'central-farma', acc1));
    const mesa = (gestor.result as { consolidation: { mesa: { agentes: Array<{ publicName: string; estado: string }> } } }).consolidation.mesa;
    expect(mesa.agentes.find((a) => a.publicName === 'ADS')?.estado).toBe('CONCLUIDO');
  });
});
