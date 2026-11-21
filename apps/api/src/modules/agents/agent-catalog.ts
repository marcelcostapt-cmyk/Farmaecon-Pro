// Catálogo dos agentes do Escritório Virtual.
//
// `publicName` é a interface pública definida no design C2 (docs/design/tokens.css, --fa-ag-*):
// Gestor, Analista, Anúncios, Criativo, ADS e SAC. `internalName` é a identificação interna usada
// pela Diretiva Mestre. Correspondência 1:1 (sem duplicações) documentada em docs/agentes-escritorio.md.
//
// `key` é o identificador técnico estável (rotas, banco). Não mudar: a Central Farma já executa.
// `implemented: false` = sem execução no produto; a API recusa a execução e a UI mostra
// "Ainda não implementado", nunca um estado ativo. Não confundir com `.claude/agents/`.

export interface AgentDefinition {
  key: string;
  publicName: string;
  internalName: string;
  accent: 'gestor' | 'analista' | 'anuncios' | 'criativo' | 'ads' | 'sac';
  sector: string;
  description: string;
  implemented: boolean;
}

export const AGENT_CATALOG: readonly AgentDefinition[] = [
  {
    key: 'central-farma',
    publicName: 'Gestor',
    internalName: 'Central Farma',
    accent: 'gestor',
    sector: 'Orquestração e gestão',
    description: 'Orquestra a análise financeira de leitura por conta: margem por SKU, alertas de limite e variação de taxas ML.',
    implemented: true,
  },
  {
    key: 'dose-certa',
    publicName: 'Analista',
    internalName: 'Dose Certa',
    accent: 'analista',
    sector: 'Preço, custo e rentabilidade',
    description: 'Custos, CMV e rentabilidade. Buy Box e ruptura ainda não implementados.',
    implemented: false,
  },
  {
    key: 'mix-ativo',
    publicName: 'Anúncios',
    internalName: 'Mix Ativo',
    accent: 'anuncios',
    sector: 'Catálogo e promoções',
    description: 'Revisa anúncios e avalia promoções com base na margem validada.',
    implemented: false,
  },
  {
    key: 'vitrine-farma',
    publicName: 'Criativo',
    internalName: 'Vitrine Farma',
    accent: 'criativo',
    sector: 'Peças e identidade',
    description: 'Briefings, imagens e infográficos para anúncios.',
    implemented: false,
  },
  {
    key: 'giro-ads',
    publicName: 'ADS',
    internalName: 'Giro Ads',
    accent: 'ads',
    sector: 'Campanhas e desempenho',
    description: 'Campanhas de publicidade e proposta de verba. Depende da integração ADS na margem.',
    implemented: false,
  },
  {
    key: 'balcao-digital',
    publicName: 'SAC',
    internalName: 'Balcão Digital',
    accent: 'sac',
    sector: 'Perguntas e reclamações',
    description: 'Classifica solicitações e prepara rascunhos de resposta para revisão humana.',
    implemented: false,
  },
];

export function findAgent(key: string): AgentDefinition | undefined {
  return AGENT_CATALOG.find((a) => a.key === key);
}
