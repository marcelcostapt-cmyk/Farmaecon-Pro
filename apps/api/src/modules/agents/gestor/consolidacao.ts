// Mesa de reunião do GESTOR. Função PURA: só CONSOLIDA resultados já persistidos pelos agentes
// (Analista e ADS). Não recalcula margem, custo, investimento nem ROAS. Sem execução concluída,
// o agente aparece com o estado real e uma pendência, nunca com resultado inventado.

export type EstadoAgente = 'NUNCA_EXECUTADO' | 'EM_EXECUCAO' | 'CONCLUIDO' | 'BLOQUEADO' | 'FALHOU';

export interface FindingPersistido {
  id: string;
  severity: 'risco' | 'pendencia' | 'info';
  title: string;
  detail?: string;
}

export interface AgenteConsultado {
  agentKey: 'dose-certa' | 'giro-ads' | 'vitrine-farma';
  publicName: string; // Analista | ADS | Anúncios
  internalName: string; // Dose Certa | Giro Ads
  run: { id: string; status: 'RUNNING' | 'COMPLETED' | 'BLOCKED' | 'FAILED'; startedAt: string; blockReason: string | null; errorMessage: string | null } | null;
  // Resultado persistido (apenas quando COMPLETED). Nunca recalculado aqui.
  result: { findings: FindingPersistido[]; recommendations: Array<{ text: string; basedOn: string[] }> } | null;
}

export interface MesaReuniao {
  temResultados: boolean;
  agentes: Array<{
    agentKey: string;
    publicName: string;
    internalName: string;
    estado: EstadoAgente;
    execucaoId: string | null;
    dataExecucao: string | null;
    motivo: string | null;
    achadosPrincipais: string[];
  }>;
  problemas: Array<{ agente: string; titulo: string }>;
  prioridades: Array<{ ordem: number; agente: string; titulo: string; severidade: 'risco' | 'pendencia' }>;
  recomendacoes: Array<{ agente: string; texto: string }>;
  pendencias: Array<{ agente: string; titulo: string }>;
}

const MAX_PRIORIDADES = 5;

function estadoDe(run: AgenteConsultado['run']): EstadoAgente {
  if (run === null) return 'NUNCA_EXECUTADO';
  switch (run.status) {
    case 'RUNNING':
      return 'EM_EXECUCAO';
    case 'COMPLETED':
      return 'CONCLUIDO';
    case 'BLOCKED':
      return 'BLOQUEADO';
    case 'FAILED':
      return 'FALHOU';
  }
}

export function consolidarMesa(agentes: AgenteConsultado[]): MesaReuniao {
  const linhas = agentes.map((a) => {
    const estado = estadoDe(a.run);
    const concluido = estado === 'CONCLUIDO' && a.result !== null;
    const achados = concluido ? a.result!.findings : [];
    return {
      agente: a.publicName,
      agentKey: a.agentKey,
      publicName: a.publicName,
      internalName: a.internalName,
      estado,
      execucaoId: a.run?.id ?? null,
      dataExecucao: a.run?.startedAt ?? null,
      motivo: estado === 'BLOQUEADO' ? (a.run?.blockReason ?? 'dependência em falta') : estado === 'FALHOU' ? (a.run?.errorMessage ?? 'falhou') : estado === 'NUNCA_EXECUTADO' ? 'sem execução registada' : estado === 'EM_EXECUCAO' ? 'execução em curso' : null,
      achados,
      recomendacoes: concluido ? a.result!.recommendations.map((r) => ({ agente: a.publicName, texto: r.text })) : [],
    };
  });

  const riscos = linhas.flatMap((l) => l.achados.filter((f) => f.severity === 'risco').map((f) => ({ agente: l.agente, titulo: f.title, severidade: 'risco' as const })));
  const pendenciasAchados = linhas.flatMap((l) => l.achados.filter((f) => f.severity === 'pendencia').map((f) => ({ agente: l.agente, titulo: f.title })));
  const pendenciasAgentes = linhas.filter((l) => l.estado !== 'CONCLUIDO').map((l) => ({ agente: l.agente, titulo: `${l.estado === 'NUNCA_EXECUTADO' ? 'Nunca executado' : l.estado === 'BLOQUEADO' ? 'Bloqueado' : l.estado === 'FALHOU' ? 'Falhou' : 'Em execução'}: ${l.motivo}` }));
  const pendencias = [...pendenciasAgentes, ...pendenciasAchados];
  const prioridades = [...riscos, ...pendenciasAchados.map((p) => ({ ...p, severidade: 'pendencia' as const }))]
    .slice(0, MAX_PRIORIDADES)
    .map((p, i) => ({ ordem: i + 1, ...p }));

  return {
    temResultados: linhas.some((l) => l.estado === 'CONCLUIDO'),
    agentes: linhas.map((l) => ({
      agentKey: l.agentKey,
      publicName: l.publicName,
      internalName: l.internalName,
      estado: l.estado,
      execucaoId: l.execucaoId,
      dataExecucao: l.dataExecucao,
      motivo: l.motivo,
      achadosPrincipais: l.achados.filter((f) => f.severity !== 'info').slice(0, 3).map((f) => f.title),
    })),
    problemas: riscos.map(({ agente, titulo }) => ({ agente, titulo })),
    prioridades,
    recomendacoes: linhas.flatMap((l) => l.recomendacoes),
    pendencias,
  };
}
