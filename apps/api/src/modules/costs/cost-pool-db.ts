import { Prisma } from '@prisma/client';
import { computeBonusCalculations } from './bonus-calc';
import { buildCostPoolFromInvoice } from './cmv-preview';
import type { DocumentSource, UnifiedInvoice, UnifiedInvoiceLine } from './document-parser';
import type { CostPoolEntry } from './cost-matching';

// Linhas/faturas lidas da BD (purchase_invoices + purchase_invoice_items), já em Decimal.
export interface DbPurchaseInvoice {
  source: 'XML' | 'PDF' | 'EXCEL';
  originalFilename: string;
  fileHashSha256: string;
  invoiceNumber: string | null;
  invoiceSeries: string | null;
  invoiceKey: string | null;
  issuerCnpj: string | null;
  recipientCnpj: string | null;
  issuedAt: Date | null;
  productsTotal: Prisma.Decimal | null;
  otherExpenses: Prisma.Decimal | null;
  discounts: Prisma.Decimal | null;
  documentTotal: Prisma.Decimal | null;
  paymentAmountInDocument: Prisma.Decimal | null;
  hasBonus: boolean;
  bonusAmount: Prisma.Decimal | null;
  paidAmount: Prisma.Decimal | null;
}

export interface DbPurchaseInvoiceItem {
  lineNumber: string;
  sourceRef: string;
  supplierProductCode: string | null;
  ean: string | null;
  marketplaceSku: string | null;
  description: string | null;
  ncm: string | null;
  unit: string | null;
  quantity: Prisma.Decimal | null;
  unitCostExtracted: Prisma.Decimal | null;
  unitCostPaid: Prisma.Decimal | null;
  totalLine: Prisma.Decimal | null;
  discount: Prisma.Decimal | null;
  otherExpense: Prisma.Decimal | null;
  cfop: string | null;
  lotNumber: string | null;
  fabricationDate: Date | null;
  expiryDate: Date | null;
  anvisaRegister: string | null;
  anvisaExemptionReason: string | null;
  pmc: Prisma.Decimal | null;
  productsValue: Prisma.Decimal | null;
  ipiAmount: Prisma.Decimal | null;
  icmsStAmount: Prisma.Decimal | null;
  isBonus: boolean;
}

// Data de calendário (UTC) em AAAA-MM-DD, a mesma forma usada pelo parser da NF-e.
const toIsoDay = (d: Date | null): string | null => (d === null ? null : d.toISOString().slice(0, 10));

const SRC: Record<DbPurchaseInvoice['source'], DocumentSource> = { XML: 'xml', PDF: 'pdf', EXCEL: 'xlsx' };

/** Reconstrói a estrutura unificada a partir das linhas persistidas (recalcula bonificação). */
export function dbToUnifiedInvoice(inv: DbPurchaseInvoice, items: DbPurchaseInvoiceItem[]): UnifiedInvoice {
  const lines: UnifiedInvoiceLine[] = items.map((i) => ({
    lineNumber: i.lineNumber,
    sourceRef: i.sourceRef,
    supplierProductCode: i.supplierProductCode,
    ean: i.ean,
    marketplaceSku: i.marketplaceSku,
    description: i.description,
    ncm: i.ncm,
    unit: i.unit,
    quantity: i.quantity,
    unitCostExtracted: i.unitCostExtracted,
    unitCostPaid: i.unitCostPaid,
    totalLine: i.totalLine,
    discount: i.discount,
    otherExpense: i.otherExpense,
    cfop: i.cfop,
    lotNumber: i.lotNumber,
    fabricationDate: toIsoDay(i.fabricationDate),
    expiryDate: toIsoDay(i.expiryDate),
    anvisaRegister: i.anvisaRegister,
    anvisaExemptionReason: i.anvisaExemptionReason,
    pmc: i.pmc,
    productsValue: i.productsValue,
    ipi: i.ipiAmount,
    icmsSt: i.icmsStAmount,
    isBonus: i.isBonus,
    approvedAcquisitionCost: null,
    warnings: [],
  }));
  // Recalcula candidatos de bonificação: productsValue = totalLine (guardado como vItem ?? vProd).
  const bonusCalculations = computeBonusCalculations({
    lines: items.map((i) => ({
      ean: i.ean,
      supplierProductCode: i.supplierProductCode,
      isBonus: i.isBonus,
      quantity: i.quantity ?? new Prisma.Decimal(0),
      productsValue: i.totalLine,
      lineNumber: i.lineNumber,
    })),
  });
  return {
    source: SRC[inv.source],
    originalFilename: inv.originalFilename,
    fileHashSha256: inv.fileHashSha256,
    extractionIncomplete: false, // reconstruído da BD: itens já persistidos existem

    invoiceNumber: inv.invoiceNumber,
    invoiceSeries: inv.invoiceSeries,
    invoiceKey: inv.invoiceKey,
    issuerCnpj: inv.issuerCnpj,
    recipientCnpj: inv.recipientCnpj,
    issuedAt: inv.issuedAt,
    productsTotal: inv.productsTotal,
    otherExpenses: inv.otherExpenses,
    discounts: inv.discounts,
    documentTotal: inv.documentTotal,
    fiscalTotal: inv.documentTotal,
    paymentAmountInDocument: inv.paymentAmountInDocument,
    hasBonus: inv.hasBonus,
    bonusAmount: inv.bonusAmount,
    paidAmount: inv.paidAmount,
    bonusCalculations,
    lines,
    warnings: [],
  };
}

/** Acervo de custos (pending_review) a partir das faturas persistidas do tenant. */
export function buildCostPoolFromDb(
  invoices: Array<{ invoice: DbPurchaseInvoice; items: DbPurchaseInvoiceItem[] }>,
): CostPoolEntry[] {
  return invoices.flatMap(({ invoice, items }) => buildCostPoolFromInvoice(dbToUnifiedInvoice(invoice, items)));
}
