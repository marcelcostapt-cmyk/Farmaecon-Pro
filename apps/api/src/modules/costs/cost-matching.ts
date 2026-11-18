import { Prisma } from '@prisma/client';

export type CostSourceType = 'xml' | 'pdf' | 'xlsx' | 'manual';
export type ApprovalStatus = 'extracted' | 'pending_review' | 'approved';
export type MatchKey = 'ean' | 'marketplace_sku' | 'supplier_code' | 'normalized_description';
export type MatchStrategy = MatchKey[];
export const DEFAULT_STRATEGY: MatchStrategy = ['ean', 'marketplace_sku', 'supplier_code', 'normalized_description'];

export interface CostRuleCandidate {
  ruleKey: string;
  unitCost: Prisma.Decimal | null; // null = indisponível (ex.: bonificação sem base paga)
  formula: string;
  bonusUnits?: Prisma.Decimal;
  bonusStatus?: string;
}

export interface CostPoolEntry {
  ean: string | null;
  marketplaceSku: string | null;
  supplierCode: string | null;
  description: string | null;
  normalizedDescription: string;
  costDate: Date | null; // data do documento (issued_at)
  sourceType: CostSourceType;
  sourceDocument: string;
  sourceLine: string;
  sourceHash: string;
  allocationRuleId: string | null; // null = regra pendente
  approvalStatus: ApprovalStatus;
  isBonus: boolean;
  candidates: CostRuleCandidate[]; // 1 para item normal; N para bonificação
  warnings?: string[]; // avisos presos ao custo (ex.: outras despesas não alocadas)
}

export interface OrderItemForMatch {
  ean: string | null;
  marketplaceSku: string | null;
  description: string | null;
  quantity: Prisma.Decimal;
  soldAt: Date | null;
}

export interface CostCandidateResult {
  status: 'approved' | 'estimated' | 'unavailable';
  matchedBy: MatchKey | null;
  entry: CostPoolEntry | null;
  warnings: string[];
}

export function normalizeDescription(s: string | null): string {
  if (s == null) return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // acentos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // pontuação → espaço
    .replace(/\s+/g, ' ')
    .trim();
}

function keyMatches(key: MatchKey, item: OrderItemForMatch, e: CostPoolEntry): boolean {
  switch (key) {
    case 'ean':
      return item.ean != null && e.ean === item.ean;
    case 'marketplace_sku':
      return item.marketplaceSku != null && e.marketplaceSku === item.marketplaceSku;
    case 'supplier_code':
      return false; // o pedido ML não traz código do fornecedor; ponto de extensão
    case 'normalized_description': {
      const n = normalizeDescription(item.description);
      return n !== '' && e.normalizedDescription === n;
    }
  }
}

// Entre vários custos do mesmo produto: o mais recente com data <= venda; se todos forem
// posteriores à venda, o mais antigo (com aviso). Sem data, o primeiro.
function pickMostRecent(matches: CostPoolEntry[], soldAt: Date | null): { entry: CostPoolEntry; afterSale: boolean } {
  if (soldAt == null) return { entry: matches[0], afterSale: false };
  const withDate = matches.filter((m) => m.costDate != null);
  if (withDate.length === 0) return { entry: matches[0], afterSale: false };
  const beforeOrEqual = withDate.filter((m) => m.costDate!.getTime() <= soldAt.getTime());
  if (beforeOrEqual.length > 0) {
    const entry = beforeOrEqual.reduce((a, b) => (b.costDate!.getTime() > a.costDate!.getTime() ? b : a));
    return { entry, afterSale: false };
  }
  const entry = withDate.reduce((a, b) => (b.costDate!.getTime() < a.costDate!.getTime() ? b : a));
  return { entry, afterSale: true };
}

/**
 * Matching SUGESTIVO (não vinculativo): percorre a estratégia na ordem dada e, no primeiro
 * critério com correspondência, escolhe o custo mais recente antes da venda. Devolve sempre a
 * origem (documento, linha, hash). Nenhum custo é publicado aqui.
 */
export function resolveCostCandidate(
  item: OrderItemForMatch,
  pool: CostPoolEntry[],
  strategy: MatchStrategy,
): CostCandidateResult {
  for (const key of strategy) {
    const matches = pool.filter((e) => keyMatches(key, item, e));
    if (matches.length === 0) continue;
    const { entry, afterSale } = pickMostRecent(matches, item.soldAt);
    const warnings: string[] = [...(entry.warnings ?? [])];
    if (afterSale) warnings.push('Custo disponível é posterior à venda; usado o mais antigo conhecido');
    if (entry.isBonus) warnings.push('Item com bonificação sem regra de alocação aprovada: valores são candidatos estimados');
    const status: CostCandidateResult['status'] = entry.allocationRuleId != null && entry.approvalStatus === 'approved' ? 'approved' : 'estimated';
    return { status, matchedBy: key, entry, warnings };
  }
  return { status: 'unavailable', matchedBy: null, entry: null, warnings: ['Sem custo correspondente no acervo de compras'] };
}
