// Catálogo dos seis agentes visíveis do Escritório Virtual C2 (nomes públicos aprovados).
//
// `publicName` = interface pública: Gestor, Analista, Anúncios, Criativo, ADS e SAC.
// `internalName` = identificação interna (especialização ou nome de produto da Diretiva), ou null.
// `key` = identificador técnico. Preservados os já implementados: central-farma, dose-certa,
// giro-ads, balcao-digital. vitrine-farma passa a Anúncios (antes estava como Criativo).
// criativo é novo: ainda sem serviço próprio.
//
// Especializações do Analista (não são agentes autónomos, não têm rota nem registo próprio):
// Dose Certa (custo, margem, CMV, análise financeira) e Mix Ativo (produtos, estoque, giro, Full, ruptura).
// Mix Ativo ainda não tem implementação.
//
// `implemented: false` = sem execução no produto; a API recusa a execução e a UI mostra
// "Ainda não implementado", nunca um estado ativo. Não confundir com `.claude/agents/`.

export interface AgentDefinition {
  key: string;
  publicName: string;
  internalName: string | null;
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
    description: 'Coordena as análises, consolida resultados e apresenta prioridades. Não recalcula números do Analista.',
    implemented: true,
  },
  {
    key: 'dose-certa',
    publicName: 'Analista',
    internalName: 'Dose Certa',
    accent: 'analista',
    sector: 'Custo, margem e rentabilidade',
    description: 'Análises determinísticas com evidências: margem por SKU, alertas de limite e variação de taxas ML. Estoque, giro, Full e ruptura (Mix Ativo) ainda não implementados.',
    implemented: true,
  },
  {
    key: 'vitrine-farma',
    publicName: 'Anúncios',
    internalName: 'Vitrine Farma',
    accent: 'anuncios',
    sector: 'Catálogo, qualidade e preços',
    description: 'Qualidade do catálogo local dos SKUs vendidos pela conta: cadastro, títulos, Anvisa, estoque e preço contra custo aprovado. Buy Box só após confirmação das APIs oficiais.',
    implemented: true,
  },
  {
    key: 'criativo',
    publicName: 'Criativo',
    internalName: null,
    accent: 'criativo',
    sector: 'Conteúdos e imagens',
    description: 'Conteúdos e imagens para anúncios, com serviços próprios a validar.',
    implemented: false,
  },
  {
    key: 'giro-ads',
    publicName: 'ADS',
    internalName: 'Giro Ads',
    accent: 'ads',
    sector: 'Campanhas e publicidade',
    description: 'Investimento em ADS importado, distribuição por SKU e campanha, e cruzamento com a margem do Analista. ROAS e ACOS só com vendas atribuídas confiáveis.',
    implemented: true,
  },
  {
    key: 'balcao-digital',
    publicName: 'SAC',
    internalName: 'Balcão Digital',
    accent: 'sac',
    sector: 'Perguntas, mensagens e reclamações',
    description: 'Atendimento: perguntas, mensagens e reclamações. Apenas documentação até confirmar APIs e políticas do Mercado Livre Brasil.',
    implemented: false,
  },
];

export function findAgent(key: string): AgentDefinition | undefined {
  return AGENT_CATALOG.find((a) => a.key === key);
}
