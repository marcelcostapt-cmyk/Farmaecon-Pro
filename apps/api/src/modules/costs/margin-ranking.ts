import type { MarginGroupLine } from './margin-preview';

export interface MarginRanking {
  /** SKUs com MAIOR margem % (só linhas disponíveis com margem positiva). */
  heroes: MarginGroupLine[];
  /** SKUs com MENOR margem % (só linhas disponíveis). Nunca repete um SKU já listado em heroes. */
  villains: MarginGroupLine[];
  /** Quantidade de linhas sem margem confirmável (custo ou taxa em falta). Não entram no ranking. */
  unavailableCount: number;
}

/**
 * Heróis e vilões por margem líquida %. Puro: usa só as linhas já calculadas por
 * computeMarginPreview(groupBy='sku'), nunca fabrica número. Desempate: maior margem em valor.
 * Linhas sem percentagem (receita zero) ficam de fora do ranking.
 */
export function rankMarginLines(lines: MarginGroupLine[], size = 5): MarginRanking {
  const ranked = lines
    .filter((l) => l.status === 'disponivel' && l.marginPercent !== null && l.margin !== null)
    .sort((a, b) => {
      const byPercent = b.marginPercent!.comparedTo(a.marginPercent!);
      return byPercent !== 0 ? byPercent : b.margin!.comparedTo(a.margin!);
    });

  // Herói exige margem positiva: uma linha com prejuízo nunca é herói, mesmo com poucas linhas.
  const heroes = ranked.filter((l) => l.marginPercent!.gt(0)).slice(0, size);
  const heroSkus = new Set(heroes.map((l) => l.key));
  const remaining = ranked.filter((l) => !heroSkus.has(l.key));
  const villains = remaining.slice(Math.max(0, remaining.length - size)).reverse();

  return { heroes, villains, unavailableCount: lines.length - ranked.length };
}
