// Catálogo dos agentes operacionais do Farmaecon Pro (nomes de produto da Diretiva Mestre).
// `implemented: false` = sem execução no produto; a API recusa executá-los e a UI mostra
// "Ainda não implementado", nunca um estado ativo. Não confundir com `.claude/agents/`
// (subagentes de desenvolvimento do Claude Code).

export interface AgentDefinition {
  key: string;
  name: string;
  sector: string;
  description: string;
  implemented: boolean;
}

export const AGENT_CATALOG: readonly AgentDefinition[] = [
  {
    key: 'central-farma',
    name: 'Central Farma',
    sector: 'Orquestração e gestão',
    description: 'Análise financeira de leitura por conta: margem por SKU, alertas de limite e variação de taxas ML.',
    implemented: true,
  },
  { key: 'dose-certa', name: 'Dose Certa', sector: 'Custos, CMV, DRE e rentabilidade', description: 'Custos, CMV, DRE e rentabilidade.', implemented: false },
  { key: 'mix-ativo', name: 'Mix Ativo', sector: 'Produtos, estoque, giro e Full', description: 'Produtos, estoque, giro e Full.', implemented: false },
  { key: 'vitrine-farma', name: 'Vitrine Farma', sector: 'Anúncios e catálogo', description: 'Anúncios e catálogo.', implemented: false },
  { key: 'giro-ads', name: 'Giro Ads', sector: 'Publicidade e desempenho', description: 'Publicidade e desempenho.', implemented: false },
  { key: 'balcao-digital', name: 'Balcão Digital', sector: 'Atendimento', description: 'Atendimento.', implemented: false },
];

export function findAgent(key: string): AgentDefinition | undefined {
  return AGENT_CATALOG.find((a) => a.key === key);
}
