import { consolidarMesa, type AgenteConsultado } from './consolidacao';

const analista = (over: Partial<AgenteConsultado> = {}): AgenteConsultado => ({
  agentKey: 'dose-certa',
  publicName: 'Analista',
  internalName: 'Dose Certa',
  run: { id: 'run-a', status: 'COMPLETED', startedAt: '2026-11-21T10:00:00Z', blockReason: null, errorMessage: null },
  result: {
    findings: [
      { id: 'cobertura', severity: 'info', title: '2 de 3 SKUs com margem' },
      { id: 'alerta-1', severity: 'risco', title: 'SKU B abaixo do limite de margem' },
      { id: 'taxa-1', severity: 'risco', title: 'Taxa do SKU A subiu' },
    ],
    recommendations: [{ text: 'Rever preço do SKU B.', basedOn: ['alerta-1'] }],
  },
  ...over,
});

const ads = (over: Partial<AgenteConsultado> = {}): AgenteConsultado => ({
  agentKey: 'giro-ads',
  publicName: 'ADS',
  internalName: 'Giro Ads',
  run: { id: 'run-g', status: 'COMPLETED', startedAt: '2026-11-21T11:00:00Z', blockReason: null, errorMessage: null },
  result: {
    findings: [{ id: 'sem-receita-atribuida', severity: 'pendencia', title: 'ROAS e ACOS indisponíveis' }],
    recommendations: [{ text: 'Importar relatório com vendas atribuídas.', basedOn: [] }],
  },
  ...over,
});

describe('Mesa de reunião do Gestor — consolidação', () => {
  it('consolida achados e recomendações de agentes concluídos, com origem e data', () => {
    const m = consolidarMesa([analista(), ads()]);
    expect(m.temResultados).toBe(true);
    expect(m.agentes.map((a) => [a.publicName, a.estado, a.execucaoId, a.dataExecucao])).toEqual([
      ['Analista', 'CONCLUIDO', 'run-a', '2026-11-21T10:00:00Z'],
      ['ADS', 'CONCLUIDO', 'run-g', '2026-11-21T11:00:00Z'],
    ]);
    expect(m.problemas.map((p) => p.titulo)).toEqual(['SKU B abaixo do limite de margem', 'Taxa do SKU A subiu']);
    expect(m.recomendacoes.map((r) => r.agente)).toEqual(['Analista', 'ADS']);
  });

  it('prioriza riscos antes de pendências e limita a cinco', () => {
    const m = consolidarMesa([analista(), ads()]);
    expect(m.prioridades[0]).toMatchObject({ ordem: 1, agente: 'Analista', severidade: 'risco' });
    expect(m.prioridades.length).toBeLessThanOrEqual(5);
    expect(m.prioridades.map((p) => p.severidade).indexOf('pendencia')).toBeGreaterThan(m.prioridades.map((p) => p.severidade).indexOf('risco'));
  });

  it('agente nunca executado aparece como tal, com pendência, sem achados inventados', () => {
    const m = consolidarMesa([analista({ run: null, result: null }), ads()]);
    const a = m.agentes.find((x) => x.publicName === 'Analista')!;
    expect(a).toMatchObject({ estado: 'NUNCA_EXECUTADO', execucaoId: null, dataExecucao: null, achadosPrincipais: [] });
    expect(m.pendencias).toContainEqual({ agente: 'Analista', titulo: 'Nunca executado: sem execução registada' });
    expect(m.recomendacoes.every((r) => r.agente !== 'Analista')).toBe(true);
  });

  it('agente bloqueado ou com falha mostra o motivo real', () => {
    const bloq = consolidarMesa([analista({ run: { id: 'r', status: 'BLOCKED', startedAt: 'x', blockReason: 'SEM_DADOS_ADS', errorMessage: null }, result: null }), ads()]);
    expect(bloq.agentes[0]).toMatchObject({ estado: 'BLOQUEADO', motivo: 'SEM_DADOS_ADS' });
    const falha = consolidarMesa([analista(), ads({ run: { id: 'r2', status: 'FAILED', startedAt: 'y', blockReason: null, errorMessage: 'A análise falhou.' }, result: null })]);
    expect(falha.agentes[1]).toMatchObject({ estado: 'FALHOU', motivo: 'A análise falhou.' });
  });

  it('sem nenhum resultado concluído: temResultados é falso e nada é inventado', () => {
    const m = consolidarMesa([analista({ run: null, result: null }), ads({ run: null, result: null })]);
    expect(m.temResultados).toBe(false);
    expect(m.prioridades).toEqual([]);
    expect(m.problemas).toEqual([]);
    expect(m.pendencias).toHaveLength(2);
  });

  it('não recalcula: o texto e os achados são exatamente os persistidos', () => {
    const base = analista();
    const m = consolidarMesa([base]);
    expect(m.agentes[0].achadosPrincipais).toEqual(['SKU B abaixo do limite de margem', 'Taxa do SKU A subiu']);
    expect(m.recomendacoes[0].texto).toBe('Rever preço do SKU B.');
  });
});
