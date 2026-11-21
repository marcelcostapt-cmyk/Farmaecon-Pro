import { Prisma } from '@prisma/client';
import { analyseAds, ADS_BLOCK_REASONS, ADS_RULES, computeAcos, computeRoas, type AdsAnalysisInput, type AdsProfile } from './ads-analysis';

const D = (v: string | number) => new Prisma.Decimal(v);

function profile(overrides: Partial<AdsProfile> = {}): AdsProfile {
  return {
    rows: 4,
    firstDay: '2026-11-10',
    lastDay: '2026-11-11',
    importBatches: 1,
    total: D(100),
    unallocated: D(0),
    bySku: [{ sku: 'SKU-A', amount: D(60) }, { sku: 'SKU-B', amount: D(40) }],
    byCampaign: [{ campaign: 'C1', amount: D(60) }, { campaign: 'C2', amount: D(40) }],
    ...overrides,
  };
}

const analistaOk = { status: 'COMPLETED' as const, runId: 'run-analista', runAt: '2026-11-21T10:00:00Z', marginAlertSkus: [] as string[] };

function input(overrides: Partial<AdsAnalysisInput> = {}): AdsAnalysisInput {
  return { account: { id: 'acc-1', name: 'Conta 1', status: 'ACTIVE' }, profile: profile(), analista: analistaOk, ...overrides };
}

describe('Giro Ads — fórmulas ROAS e ACOS', () => {
  it('ROAS = receita atribuída ÷ investimento; ACOS = investimento ÷ receita × 100', () => {
    expect(computeRoas(D(50), D(200))?.toString()).toBe('4');
    expect(computeAcos(D(50), D(200))?.toString()).toBe('25');
  });

  it('sem receita atribuída devolve null (nunca estima)', () => {
    expect(computeRoas(D(50), null)).toBeNull();
    expect(computeAcos(D(50), null)).toBeNull();
  });

  it('receita zero ou investimento zero nunca divide por zero', () => {
    expect(computeAcos(D(50), D(0))).toBeNull();
    expect(computeRoas(D(0), D(200))).toBeNull();
  });
});

describe('Giro Ads — bloqueios e ausência de dados', () => {
  it('conta desligada não é analisada', () => {
    const r = analyseAds(input({ account: { id: 'acc-1', name: 'C', status: 'DISCONNECTED' } }));
    expect(r.status).toBe('BLOCKED');
    expect(r.blockReason).toBe(ADS_BLOCK_REASONS.ACCOUNT_DISCONNECTED);
    expect(r.metrics.investimento).toBeNull();
  });

  it('sem linhas de ADS importadas: BLOCKED, sem investimento nem ROAS inventados', () => {
    const r = analyseAds(input({ profile: null }));
    expect(r.status).toBe('BLOCKED');
    expect(r.blockReason).toBe(ADS_BLOCK_REASONS.NO_ADS_DATA);
    expect(r.metrics).toMatchObject({ investimento: null, roas: null, acos: null });
    expect(r.findings).toEqual([]);
  });

  it('perfil com zero linhas é tratado como ausência de dados', () => {
    expect(analyseAds(input({ profile: profile({ rows: 0 }) })).blockReason).toBe(ADS_BLOCK_REASONS.NO_ADS_DATA);
  });
});

describe('Giro Ads — métricas e origem', () => {
  it('investimento, período e origem vêm dos dados importados', () => {
    const r = analyseAds(input());
    expect(r.metrics.investimento).toBe('100.00');
    expect(r.period).toEqual({ inicio: '2026-11-10', fim: '2026-11-11' });
    expect(r.origem).toMatchObject({ linhasImportadas: 4, ficheirosImportados: 1, fonte: 'ads_costs (CSV importado)' });
  });

  it('ROAS e ACOS ficam indisponíveis sem vendas atribuídas, com motivo explícito', () => {
    const r = analyseAds(input());
    expect(r.metrics).toMatchObject({ receitaAtribuida: null, roas: null, acos: null });
    expect(r.metrics.motivoRoasAcos).toMatch(/não têm vendas atribuídas/);
    expect(r.findings.find((f) => f.id === 'sem-receita-atribuida')?.severity).toBe('pendencia');
  });

  it('não atribui vendas orgânicas nem trata investimento como lucro (caveats explícitos)', () => {
    const r = analyseAds(input());
    const text = r.caveats.join(' ');
    expect(text).toMatch(/Não é misturado com o DRE/);
    expect(text).toMatch(/Receita de campanhas não é lucro/);
    expect(text).toMatch(/Vendas orgânicas não são atribuídas/);
  });
});

describe('Giro Ads — regras explícitas', () => {
  it('gasto sem SKU acima do limite é risco; abaixo é pendência', () => {
    const risco = analyseAds(input({ profile: profile({ unallocated: D(30), total: D(100) }) }));
    expect(risco.findings.find((f) => f.id === 'sem-sku')?.severity).toBe('risco');
    const pend = analyseAds(input({ profile: profile({ unallocated: D(10), total: D(100) }) }));
    expect(pend.findings.find((f) => f.id === 'sem-sku')?.severity).toBe('pendencia');
    expect(ADS_RULES.UNALLOCATED_RISK_PCT).toBe(20);
  });

  it('sem gasto sem SKU, não há achado de sem-sku', () => {
    expect(analyseAds(input()).findings.some((f) => f.id === 'sem-sku')).toBe(false);
  });

  it('campanha acima de 50% do gasto é concentração', () => {
    const r = analyseAds(input({ profile: profile({ byCampaign: [{ campaign: 'C1', amount: D(70) }, { campaign: 'C2', amount: D(30) }] }) }));
    const f = r.findings.find((x) => x.id === 'concentracao');
    expect(f?.evidence).toMatchObject({ campanha: 'C1', percentual: '70.0' });
  });

  it('campanha com 50% exatos não é concentração (limite estrito)', () => {
    const r = analyseAds(input({ profile: profile({ byCampaign: [{ campaign: 'C1', amount: D(50) }, { campaign: 'C2', amount: D(50) }] }) }));
    expect(r.findings.some((f) => f.id === 'concentracao')).toBe(false);
  });

  it('SKU com investimento e alerta de margem do Analista vira risco, com recomendação de revisão (não de ação)', () => {
    const r = analyseAds(input({ analista: { ...analistaOk, marginAlertSkus: ['SKU-B'] } }));
    const risk = r.findings.find((f) => f.severity === 'risco' && f.evidence.sku === 'SKU-B');
    expect(risk?.evidence).toMatchObject({ investimento: '40.00', analistaExecucao: 'run-analista' });
    const rec = r.recommendations.find((x) => x.basedOn.includes(risk!.id));
    expect(rec?.text).toMatch(/Rever o investimento/);
    expect(rec?.text).not.toMatch(/pausar|aumentar verba automaticamente|alterar/i);
  });

  it('SKU sem alerta do Analista não gera risco de margem', () => {
    const r = analyseAds(input({ analista: { ...analistaOk, marginAlertSkus: ['SKU-Z'] } }));
    expect(r.findings.some((f) => f.severity === 'risco' && f.evidence.sku)).toBe(false);
  });

  it('Analista sem execução concluída: margem não avaliada, sem inventar cruzamento', () => {
    const r = analyseAds(input({ analista: { status: 'NOT_RUN', runId: null, runAt: null, marginAlertSkus: [] } }));
    expect(r.findings.find((f) => f.id === 'margem-nao-avaliada')?.evidence).toMatchObject({ analistaEstado: 'NOT_RUN' });
    expect(r.findings.some((f) => f.evidence.sku !== undefined && f.severity === 'risco')).toBe(false);
  });

  it('nenhum valor NaN ou Infinity aparece no resultado', () => {
    const r = analyseAds(input({ profile: profile({ total: D(0), unallocated: D(0), byCampaign: [], bySku: [] }) }));
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });
});
