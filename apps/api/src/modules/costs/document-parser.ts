import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { parseNfeXml } from './nfe-xml-parser';
import { parsePdfText, extrairTextoPdf } from './nfe-pdf-parser';
import { parseCostsSpreadsheet } from './excel-cost-parser';

export type DocumentSource = 'xml' | 'pdf' | 'xlsx';

export interface UnifiedInvoiceLine {
  lineNumber: string;
  sourceRef: string; // rastreabilidade: det[1], linha 1, A2, C49…
  supplierProductCode: string | null;
  ean: string | null;
  marketplaceSku: string | null;
  description: string | null;
  quantity: Prisma.Decimal | null;
  unitCostExtracted: Prisma.Decimal | null;
  totalLine: Prisma.Decimal | null;
  cfop: string | null;
  lotNumber: string | null;
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
  documentTotal: Prisma.Decimal | null;
  paymentAmountInDocument: Prisma.Decimal | null;
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
      productsTotal: nf.productsTotal, otherExpenses: null, documentTotal: null, paymentAmountInDocument: nf.paymentAmountInDocument,
      warnings: nf.warnings,
      lines: nf.lines.map((l) => ({
        lineNumber: l.lineNumber, sourceRef: `det[${l.lineNumber}]`,
        supplierProductCode: l.supplierProductCode, ean: l.ean, marketplaceSku: null, description: l.description,
        quantity: l.quantity, unitCostExtracted: l.unitCostExtracted,
        totalLine: l.totalLine ?? l.productsValue, cfop: l.cfop,
        lotNumber: l.lots.length === 1 ? l.lots[0].lot : l.lots.length ? l.lots.map((x) => x.lot).join('+') : null,
        approvedAcquisitionCost: null,
        warnings: l.lots.length > 1 ? [...l.warnings, `Linha com ${l.lots.length} lotes`] : l.warnings,
      })),
    };
  }

  if (source === 'pdf') {
    const nf = parsePdfText(await extrairTextoPdf(buffer));
    return {
      ...base, invoiceNumber: nf.invoiceNumber, invoiceSeries: nf.invoiceSeries, invoiceKey: nf.invoiceKey,
      issuerCnpj: null, recipientCnpj: null, issuedAt: nf.issuedAt,
      productsTotal: nf.productsTotal, otherExpenses: nf.otherExpenses, documentTotal: nf.documentTotal, paymentAmountInDocument: null,
      warnings: nf.warnings,
      lines: nf.lines.map((l) => ({
        lineNumber: l.lineNumber, sourceRef: `linha ${l.lineNumber}`,
        supplierProductCode: l.supplierProductCode, ean: l.ean, marketplaceSku: l.marketplaceSku, description: l.description,
        quantity: l.quantity, unitCostExtracted: l.unitCostExtracted, totalLine: l.totalLine, cfop: null, lotNumber: l.lot,
        approvedAcquisitionCost: null, warnings: l.warnings,
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
    productsTotal: null, otherExpenses: null, documentTotal: null, paymentAmountInDocument: null,
    warnings,
    lines: planilha.costRows.map((r, i) => ({
      lineNumber: String(i + 1), sourceRef: `${r.sheet}!${r.sourceCell}`,
      supplierProductCode: null, ean: r.ean, marketplaceSku: null, description: r.description,
      quantity: null, unitCostExtracted: r.unitCost, totalLine: null, cfop: null, lotNumber: null,
      approvedAcquisitionCost: null, warnings: r.warnings,
    })),
  };
}
