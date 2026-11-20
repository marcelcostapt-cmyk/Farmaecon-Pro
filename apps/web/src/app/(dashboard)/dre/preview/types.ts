// Tipos da UI de revisão/publicação de custos (/dre/preview).
// Os valores monetários chegam da API como string (Decimal) — a UI não faz aritmética.

export type BonusRule = 'PROPORTIONAL' | 'SPECIFIC_SKU' | 'IGNORE';

/** Linha da prévia extraída do documento (não persistida; só exibição). */
export interface PreviewLine {
  lineNumber: string;
  supplierProductCode: string | null;
  ean: string | null;
  marketplaceSku: string | null;
  description: string | null;
  quantity: string | null;
  unitCostExtracted: string | null;
  unitCostPaid: string | null;
  totalLine: string | null;
  isBonus: boolean;
}

export interface AccountMatch {
  reason: string;
  requiresReview: boolean;
  linkedAccountId: string | null;
  candidates: string[];
}

export interface IngestResult {
  invoiceId: string;
  created: boolean;
  itemCount: number;
  extractionIncomplete: boolean;
  accountMatch: AccountMatch | null;
}

export interface UploadResult {
  ingest: IngestResult;
  lines: PreviewLine[];
}

/** Resultado de :id/bonus — custo sugerido por linha (nunca custo fabricado: null = indisponível). */
export interface BonusLineResult {
  lineNumber: string;
  allocatedBonus: string;
  bonusQuantity: string;
  unitCostApproved: string | null;
}

export interface BonusResult {
  invoiceId: string;
  items: BonusLineResult[];
}

export interface PublishResult {
  invoiceId: string;
  ruleType: string;
  publishedCount: number;
  costs: { ean: string | null; sku: string | null; unitCost: string }[];
}

/** Conta ML disponível para vínculo manual (subconjunto usado pelo select). */
export interface MlAccountOption {
  id: string;
  name: string;
  displayName: string | null;
  externalSellerId: string | null;
  cnpj: string | null;
}
