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
  // true quando o documento tem produtos mas nenhuma linha foi extraída: a importação
  // deve ficar pendente/falhar, NUNCA concluir com custo zero (regra 5.2).
  extractionIncomplete: boolean;
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

/**
 * Lógica pura de parsing do texto de um DANFE (saída do pdfjs/pdf-parse). Determinística
 * e testável sem OCR. O layout real do pdfjs achata a DANFE: rótulos de totais e os seus
 * valores ficam em linhas separadas, e cada produto ocupa várias linhas
 * (código+descrição / lote / linha numérica NCM O/CST CFOP UN QUANT V.UNIT V.TOTAL V.DESC …).
 */
export function parsePdfText(texto: string): ParsedPdfInvoice {
  const warnings: string[] = [];
  const rawLines = texto.split(/\r?\n/).map((s) => s.replace(/[ \t]+/g, ' ').trim());
  const joined = rawLines.join('\n');

  // --- Cabeçalho ---
  const num = joined.match(/N[º°o]\.?\s*([0-9][0-9.]{3,})/i);
  const serie = joined.match(/S[ée]rie\s*(\d+)/i);
  const emi = joined.match(/EMISS[ÃA]O[:\s]+(\d{2})\/(\d{2})\/(\d{4})/i);

  // Chave: 44 dígitos, possivelmente formatados em grupos com espaços, após "CHAVE DE ACESSO".
  let invoiceKey: string | null = null;
  const ci = rawLines.findIndex((l) => /CHAVE DE ACESSO/i.test(l));
  if (ci >= 0) {
    for (let k = ci + 1; k < Math.min(ci + 3, rawLines.length); k++) {
      const digits = rawLines[k].replace(/\D/g, '');
      if (digits.length === 44) { invoiceKey = digits; break; }
    }
  }
  if (!invoiceKey) { const m = joined.replace(/[ \t]/g, '').match(/\d{44}/); if (m) invoiceKey = m[0]; }

  // --- Totais: rótulo numa linha, valor na linha seguinte ---
  const valorApos = (rotuloRe: RegExp): Prisma.Decimal | null => {
    const i = rawLines.findIndex((l) => rotuloRe.test(l));
    if (i < 0) return null;
    for (let k = i + 1; k < Math.min(i + 3, rawLines.length); k++) {
      const m = rawLines[k].match(/^([\d.]*\d,\d{2})$/);
      if (m) return brMoney(m[1]);
    }
    return null;
  };
  const productsTotal = valorApos(/^V\.?\s*TOTAL\s+PRODUTOS/i);
  const otherExpenses = valorApos(/^OUTRAS\s+DESPESAS/i);
  const headerTotal = joined.match(/VALOR TOTAL:\s*R\$\s*([\d.]*\d,\d{2})/i);
  const documentTotal = valorApos(/^V\.?\s*TOTAL\s+DA\s+NOTA/i) ?? (headerTotal ? brMoney(headerTotal[1]) : null);

  // --- Linhas de produto (multi-linha) ---
  // Linha numérica: NCM(8) O/CST CFOP(4) UN QUANT V.UNIT V.TOTAL V.DESC …
  const numericRe = /^(\d{8})\s+\S+\s+(\d{4})\s+([A-Z]{2,3})\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/;
  const codeDescRe = /^(\d{3,7})\s+(\D.*)$/; // código do fornecedor + descrição
  const loteRe = /Lote:\s*(\w+)/i;
  const lines: ParsedPdfLine[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (numericRe.test(rawLines[i])) continue;
    const cd = rawLines[i].match(codeDescRe);
    if (!cd) continue;
    let lote: string | null = null;
    let nm: RegExpMatchArray | null = null;
    for (let k = i + 1; k < Math.min(i + 5, rawLines.length); k++) {
      const lm = rawLines[k].match(loteRe); if (lm && !lote) lote = lm[1];
      const n = rawLines[k].match(numericRe); if (n) { nm = n; break; }
    }
    if (!nm) continue;
    const [, , , , qtd, unit, total] = nm;
    const quantity = brMoney(qtd);
    const unitCost = brMoney(unit);
    const totalLine = brMoney(total);
    const w: string[] = ['EAN não informado no documento', 'Código do fornecedor não é SKU do marketplace, vínculo requer confirmação'];
    const dif = quantity.times(unitCost).minus(totalLine).abs();
    if (dif.greaterThanOrEqualTo('0.005')) w.push(`Diferença de arredondamento entre quantidade × unitário e total informado: R$ ${fmtBr(dif)}`);
    lines.push({
      lineNumber: String(lines.length + 1),
      supplierProductCode: cd[1], ean: null, marketplaceSku: null,
      description: cd[2].trim(), quantity, unitCostExtracted: unitCost, totalLine,
      lot: lote, approvedAcquisitionCost: null, warnings: w,
    });
  }

  const totalUn = lines.reduce((s, l) => s.plus(l.quantity), new Prisma.Decimal(0));
  const conditionalAverageCost = documentTotal && totalUn.greaterThan(0) ? documentTotal.div(totalUn) : null;

  // Salvaguarda 5.2: documento tem produtos mas nenhuma linha extraída → pendente, nunca custo zero.
  const temProdutos = productsTotal !== null || /DADOS DOS PRODUTOS/i.test(joined);
  const extractionIncomplete = temProdutos && lines.length === 0;
  if (extractionIncomplete) {
    warnings.push('Documento tem produtos mas 0 linhas foram extraídas — revisão manual necessária (não concluir com custo zero)');
  }
  if (lines.length) { warnings.push('EAN não informado no documento'); warnings.push('Código do fornecedor não é SKU do marketplace, vínculo requer confirmação'); }

  return {
    source: 'pdf',
    invoiceNumber: num ? num[1].replace(/\D/g, '').replace(/^0+/, '') || null : null,
    invoiceSeries: serie ? serie[1] : null,
    invoiceKey,
    issuedAt: emi ? new Date(Date.UTC(Number(emi[3]), Number(emi[2]) - 1, Number(emi[1]))) : null,
    productsTotal, otherExpenses, documentTotal,
    conditionalAverageCost, approvedAverageCost: null,
    extractionIncomplete,
    lines, warnings,
  };
}
