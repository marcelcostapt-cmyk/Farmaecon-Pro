import { Prisma } from '@prisma/client';
import { money } from './cost-money';

export interface ParsedPdfLine {
  lineNumber: string;
  supplierProductCode: string | null;
  ean: string | null;
  marketplaceSku: string | null;
  description: string | null;
  quantity: Prisma.Decimal;
  unitCostExtracted: Prisma.Decimal | null;
  totalLine: Prisma.Decimal | null;
  lot: string | null;
  approvedAcquisitionCost: Prisma.Decimal | null;
  warnings: string[];
}

export interface ParsedPdfInvoice {
  source: 'pdf';
  invoiceNumber: string | null;
  invoiceSeries: string | null;
  invoiceKey: string | null;
  issuedAt: Date | null;
  productsTotal: Prisma.Decimal | null;
  otherExpenses: Prisma.Decimal | null;
  documentTotal: Prisma.Decimal | null;
  conditionalAverageCost: Prisma.Decimal | null; // só preview; nunca custo aprovado
  approvedAverageCost: Prisma.Decimal | null;
  lines: ParsedPdfLine[];
  warnings: string[];
}

// Converte "5.051,33" / "316,0000" (pt-BR) em Decimal exato, sem arredondar.
const brMoney = (s: string): Prisma.Decimal => money(s.replace(/\./g, '').replace(',', '.'));
const fmtBr = (d: Prisma.Decimal): string => d.toFixed(2).replace('.', ',');

/** Extrai o texto de um PDF com texto selecionável (sem OCR). Usa a API v2 do pdf-parse
 *  (classe PDFParse); PDFs só com imagem caem no erro de "OCR necessário". */
export async function extrairTextoPdf(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PDFParse } = require('pdf-parse') as typeof import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const resultado = await parser.getText();
    if (!resultado?.text?.trim()) throw new Error('PDF sem texto selecionável; OCR necessário');
    return resultado.text;
  } finally {
    await parser.destroy();
  }
}

/** Lógica pura de parsing do texto de um DANFE. Determinística e testável sem OCR. */
export function parsePdfText(texto: string): ParsedPdfInvoice {
  const warnings: string[] = [];
  const num = texto.match(/NF-?e\s*N[ºo°]?\s*([\d.]+)/i);
  const serie = texto.match(/S[ée]rie\s*(\d+)/i);
  const emi = texto.match(/Emiss[ãa]o\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  const chave = texto.match(/\b(\d{44})\b/);

  const lines: ParsedPdfLine[] = [];
  const linhaRe = /^(\d+)\s+(.+?)\s+[A-Z]{2,3}\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+(\d+)\s*$/;
  for (const raw of texto.split(/\r?\n/)) {
    const m = raw.trim().match(linhaRe);
    if (!m) continue;
    const [, code, desc, qtd, unit, total, lote] = m;
    const quantity = brMoney(qtd);
    const unitCost = brMoney(unit);
    const totalLine = brMoney(total);
    const w: string[] = ['EAN não informado no documento', 'Código do fornecedor não é SKU do marketplace, vínculo requer confirmação'];
    const calc = quantity.times(unitCost);
    const dif = calc.minus(totalLine).abs();
    if (dif.greaterThanOrEqualTo('0.005')) w.push(`Diferença de arredondamento entre quantidade × unitário e total informado: R$ ${fmtBr(dif)}`);
    lines.push({
      lineNumber: String(lines.length + 1),
      supplierProductCode: code, ean: null, marketplaceSku: null,
      description: desc.trim(), quantity, unitCostExtracted: unitCost, totalLine,
      lot: lote, approvedAcquisitionCost: null, warnings: w,
    });
  }

  const pick = (re: RegExp): Prisma.Decimal | null => { const m = texto.match(re); return m ? brMoney(m[1]) : null; };
  const productsTotal = pick(/Valor Total dos Produtos\s+([\d.,]+)/i);
  const otherExpenses = pick(/Outras Despesas[^\d]*([\d.,]+)/i);
  const documentTotal = pick(/Valor Total da Nota\s+([\d.,]+)/i);
  const totalUn = lines.reduce((s, l) => s.plus(l.quantity), new Prisma.Decimal(0));
  const conditionalAverageCost = documentTotal && totalUn.greaterThan(0) ? documentTotal.div(totalUn) : null;
  if (lines.length) { warnings.push('EAN não informado no documento'); warnings.push('Código do fornecedor não é SKU do marketplace, vínculo requer confirmação'); }

  return {
    source: 'pdf',
    invoiceNumber: num ? num[1].replace(/\./g, '') : null,
    invoiceSeries: serie ? serie[1] : null,
    invoiceKey: chave ? chave[1] : null,
    issuedAt: emi ? new Date(Date.UTC(Number(emi[3]), Number(emi[2]) - 1, Number(emi[1]))) : null,
    productsTotal, otherExpenses, documentTotal,
    conditionalAverageCost, approvedAverageCost: null,
    lines, warnings,
  };
}
