import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { parseNfeXml } from './nfe-xml-parser';
import { parsePdfText, extrairTextoPdf } from './nfe-pdf-parser';
import { parseCostsSpreadsheet } from './excel-cost-parser';
import { computeBonusCalculations, type BonusCalculation } from './bonus-calc';

export type DocumentSource = 'xml' | 'pdf' | 'xlsx';

export interface UnifiedInvoiceLine {
  lineNumber: string;
  sourceRef: string; // rastreabilidade: det[1], linha 1, A2, C49…
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
  anvisaRegister: string | null; // NF-e med/cProdANVISA (11 ou 13 dígitos, ou ISENTO)
  anvisaExemptionReason: string | null; // NF-e med/xMotivoIsencao
  pmc: Prisma.Decimal | null; // NF-e med/vPMC
  fabricationDate: string | null; // YYYY-MM-DD; só com um único lote na linha
  expiryDate: string | null; // YYYY-MM-DD; só com um único lote na linha (multi-lote → null + aviso)
  isBonus: boolean;
  approvedAcquisitionCost: null; // sempre nulo na extração; só após regra aprovada
  warnings: string[];
}

export interface UnifiedInvoice {
  source: DocumentSource;
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
  fiscalTotal: Prisma.Decimal | null;
  paymentAmountInDocument: Prisma.Decimal | null;
  hasBonus: boolean;
  bonusAmount: Prisma.Decimal | null;
  paidAmount: Prisma.Decimal | null;
  bonusCalculations: BonusCalculation[];
  // true quando há indícios de itens mas nenhuma linha foi extraída (regra 5.2):
  // o documento deve ficar PENDING_REVIEW e não contribuir custo.
  extractionIncomplete: boolean;
  lines: UnifiedInvoiceLine[];
  warnings: string[];
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function extensao(filename: string): DocumentSource {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'xml') return 'xml';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  throw new Error(`Formato de documento não suportado: .${ext}`);
}

/** Lê o documento e devolve a estrutura normalizada única, com hash e rastreabilidade. */
export async function parseDocument(filename: string, buffer: Buffer): Promise<UnifiedInvoice> {
  const source = extensao(filename);
  const base = { source, originalFilename: filename, fileHashSha256: sha256(buffer) };

  if (source === 'xml') {
    const nf = parseNfeXml(buffer);
    return {
      ...base, invoiceNumber: nf.invoiceNumber, invoiceSeries: nf.invoiceSeries, invoiceKey: nf.invoiceKey,
      issuerCnpj: nf.issuerCnpj, recipientCnpj: nf.recipientCnpj, issuedAt: nf.issuedAt,
      productsTotal: nf.productsTotal, otherExpenses: nf.otherExpenses, discounts: nf.discounts,
      documentTotal: nf.fiscalTotal, fiscalTotal: nf.fiscalTotal, paymentAmountInDocument: nf.paymentAmountInDocument,
      hasBonus: nf.hasBonus, bonusAmount: nf.bonusAmount, paidAmount: nf.paidAmount,
      bonusCalculations: computeBonusCalculations(nf), extractionIncomplete: false,
      warnings: nf.warnings,
      lines: nf.lines.map((l) => ({
        lineNumber: l.lineNumber, sourceRef: `det[${l.lineNumber}]`,
        supplierProductCode: l.supplierProductCode, ean: l.ean, marketplaceSku: null, description: l.description,
        ncm: l.ncm, unit: l.unit,
        quantity: l.quantity, unitCostExtracted: l.unitCostExtracted, unitCostPaid: l.unitCostPaid,
        totalLine: l.totalLine ?? l.productsValue, discount: l.discount, otherExpense: l.otherExpense, cfop: l.cfop,
        lotNumber: l.lots.length === 1 ? l.lots[0].lot : l.lots.length ? l.lots.map((x) => x.lot).join('+') : null,
        anvisaRegister: l.anvisaRegister, anvisaExemptionReason: l.anvisaExemptionReason, pmc: l.pmc,
        fabricationDate: l.lots.length === 1 ? l.lots[0].fabricationDate : null,
        expiryDate: l.lots.length === 1 ? l.lots[0].expiryDate : null,
        isBonus: l.isBonus, approvedAcquisitionCost: null,
        warnings:
          l.lots.length > 1
            ? [...l.warnings, `Linha com ${l.lots.length} lotes: validade/fabricação por lote não persistidas`]
            : l.warnings,
      })),
    };
  }

  if (source === 'pdf') {
    const nf = parsePdfText(await extrairTextoPdf(buffer));
    return {
      ...base, invoiceNumber: nf.invoiceNumber, invoiceSeries: nf.invoiceSeries, invoiceKey: nf.invoiceKey,
      issuerCnpj: null, recipientCnpj: null, issuedAt: nf.issuedAt,
      productsTotal: nf.productsTotal, otherExpenses: nf.otherExpenses, discounts: null,
      documentTotal: nf.documentTotal, fiscalTotal: nf.documentTotal, paymentAmountInDocument: null,
      hasBonus: false, bonusAmount: null, paidAmount: null, bonusCalculations: [], extractionIncomplete: nf.extractionIncomplete,
      warnings: nf.warnings,
      lines: nf.lines.map((l) => ({
        lineNumber: l.lineNumber, sourceRef: `linha ${l.lineNumber}`,
        supplierProductCode: l.supplierProductCode, ean: l.ean, marketplaceSku: l.marketplaceSku, description: l.description,
        ncm: null, unit: null,
        quantity: l.quantity, unitCostExtracted: l.unitCostExtracted, unitCostPaid: l.unitCostExtracted,
        totalLine: l.totalLine, discount: null, otherExpense: null, cfop: null, lotNumber: l.lot,
        fabricationDate: null, expiryDate: null, anvisaRegister: null, anvisaExemptionReason: null, pmc: null,
        isBonus: false, approvedAcquisitionCost: null, warnings: l.warnings,
      })),
    };
  }

  // xlsx: catálogo de custos (ML GERAL). Abas mensais entram só como contagem de referência.
  const planilha = await parseCostsSpreadsheet(buffer);
  const warnings = [...planilha.warnings];
  if (planilha.historicalRows.length) warnings.push(`${planilha.historicalRows.length} linhas de referência histórica (não importadas como custo)`);
  return {
    ...base, invoiceNumber: null, invoiceSeries: null, invoiceKey: null,
    issuerCnpj: null, recipientCnpj: null, issuedAt: null,
    productsTotal: null, otherExpenses: null, discounts: null, documentTotal: null, fiscalTotal: null, paymentAmountInDocument: null,
    hasBonus: false, bonusAmount: null, paidAmount: null, bonusCalculations: [], extractionIncomplete: false,
    warnings,
    lines: planilha.costRows.map((r, i) => ({
      lineNumber: String(i + 1), sourceRef: `${r.sheet}!${r.sourceCell}`,
      supplierProductCode: null, ean: r.ean, marketplaceSku: null, description: r.description,
      ncm: null, unit: null,
      quantity: null, unitCostExtracted: r.unitCost, unitCostPaid: null, totalLine: null,
      discount: null, otherExpense: null, cfop: null, lotNumber: null,
      fabricationDate: null, expiryDate: null, anvisaRegister: null, anvisaExemptionReason: null, pmc: null,
      isBonus: false, approvedAcquisitionCost: null, warnings: r.warnings,
    })),
  };
}
