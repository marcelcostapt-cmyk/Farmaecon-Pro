import { Prisma } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';
import { money } from './cost-money';

export interface ParsedLot {
  lot: string | null;
  quantity: Prisma.Decimal;
  fabricationDate: string | null; // YYYY-MM-DD (rastro/dFab)
  expiryDate: string | null; // YYYY-MM-DD (rastro/dVal)
}

export interface ParsedInvoiceLine {
  lineNumber: string;
  nItemFromAttribute: boolean;
  supplierProductCode: string | null; // cProd
  ean: string | null; // cEAN
  description: string | null; // xProd
  ncm: string | null; // NCM
  unit: string | null; // uCom
  cfop: string | null; // CFOP
  quantity: Prisma.Decimal; // qCom
  unitCostExtracted: Prisma.Decimal | null; // vUnCom (valor unitário comercial)
  unitCostPaid: Prisma.Decimal | null; // vItem/qCom, ou vProd/qCom quando vItem ausente/zero
  totalLine: Prisma.Decimal | null; // vItem (líquido)
  productsValue: Prisma.Decimal | null; // vProd (bruto)
  discount: Prisma.Decimal | null; // vDesc da linha
  otherExpense: Prisma.Decimal | null; // vOutro da linha
  lots: ParsedLot[];
  anvisaRegister: string | null; // med/cProdANVISA: 11 ou 13 dígitos, ou ISENTO (validado pelo XSD)
  anvisaExemptionReason: string | null; // med/xMotivoIsencao: 1 a 255 caracteres
  pmc: Prisma.Decimal | null; // med/vPMC: preço máximo ao consumidor (TDec_1302)
  isBonus: boolean;
  warnings: string[];
}

export interface ParsedInvoice {
  source: 'XML';
  invoiceNumber: string | null;
  invoiceSeries: string | null;
  invoiceKey: string | null;
  issuerCnpj: string | null;
  recipientCnpj: string | null;
  issuedAt: Date | null;
  fiscalTotal: Prisma.Decimal | null; // vNF
  productsTotal: Prisma.Decimal | null; // vProd
  discounts: Prisma.Decimal | null; // vDesc total
  otherExpenses: Prisma.Decimal | null; // vOutro total
  paymentAmountInDocument: Prisma.Decimal | null; // vOrig da fatura (cobr/fat), se existir
  hasBonus: boolean;
  bonusAmount: Prisma.Decimal | null; // soma do vProd das linhas de bonificação
  paidAmount: Prisma.Decimal | null; // fiscalTotal - bonusAmount
  lines: ParsedInvoiceLine[];
  warnings: string[];
}

const arr = <T>(x: T | T[] | undefined | null): T[] => (Array.isArray(x) ? x : x == null ? [] : [x]);
const text = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
// Data da NF-e (AAAA-MM-DD). Qualquer outro formato devolve null (nunca inventa data).
const isoDate = (v: unknown): string | null => {
  const t = text(v);
  return t !== null && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};
const dec = (v: unknown): Prisma.Decimal | null => {
  const s = text(v);
  return s === null ? null : money(s);
};
const BONUS_CFOP = '5910';
const BONUS_TEXT = /\bBONIFIC/i;

// Non-validating parse: external entities / DTD are not resolved (XXE-safe); values kept as
// strings so EANs keep leading zeros and money keeps full precision until an explicit Decimal.
// Padrões do XSD oficial (leiauteNFe_v4.00): grupo med (medicamentos).
const ANVISA_PATTERN = /^(\d{11}|\d{13}|ISENTO)$/;
const PMC_PATTERN = /^(0|0\.\d{2}|[1-9]\d{0,12}(\.\d{2})?)$/;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  processEntities: false,
  trimValues: true,
});

export function parseNfeXml(buffer: Buffer | string): ParsedInvoice {
  const root = parser.parse(buffer.toString('utf8'));
  const inf = root?.nfeProc?.NFe?.infNFe ?? root?.NFe?.infNFe;
  if (!inf) throw new Error('XML não é uma NF-e reconhecível (infNFe ausente)');
  const ide = (inf.ide ?? {}) as Record<string, unknown>;
  const warnings: string[] = [];
  const dhEmi = text(ide.dhEmi ?? ide.dEmi);
  const issuedAt = dhEmi ? new Date(dhEmi) : null;
  if (dhEmi && !(issuedAt && Number.isFinite(issuedAt.getTime()))) warnings.push('Data de emissão inválida');

  const infCpl = text((inf.infAdic as Record<string, unknown> | undefined)?.infCpl);

  const lines: ParsedInvoiceLine[] = arr(inf.det).map((det: Record<string, unknown>) => {
    const prod = (det.prod ?? {}) as Record<string, unknown>;
    const nItemAttr = text(det['@_nItem']);
    const nItemEl = text(det.nItem);
    const w: string[] = [];
    const vItemAbsent = det.vItem === undefined;
    const totalLine = dec(det.vItem);
    const productsValue = dec(prod.vProd);
    const quantity = dec(prod.qCom) ?? money('0');
    const cfop = text(prod.CFOP);

    // Base do valor pago pela linha: vItem quando presente e > 0; senão vProd (com aviso).
    let paidLineTotal = totalLine;
    if (totalLine === null && productsValue !== null) {
      w.push('vItem ausente na linha; usado vProd');
      paidLineTotal = productsValue;
    } else if (totalLine !== null && totalLine.isZero() && productsValue !== null && !productsValue.isZero()) {
      w.push('vItem igual a 0,00 na linha; usado vProd');
      paidLineTotal = productsValue;
    }
    const unitCostPaid = paidLineTotal !== null && quantity.gt(0) ? paidLineTotal.div(quantity) : null;

    const lots = arr(prod.rastro as Record<string, unknown> | Record<string, unknown>[]).map((r) => ({
      lot: text(r.nLote),
      quantity: dec(r.qLote) ?? money('0'),
      fabricationDate: isoDate(r.dFab),
      expiryDate: isoDate(r.dVal),
    }));

    // Grupo med: valores inválidos ficam de fora e geram aviso (nunca se grava dado fora do XSD).
    const med = (prod.med ?? null) as Record<string, unknown> | null;
    const anvisaRaw = med ? text(med.cProdANVISA) : null;
    const anvisaRegister = anvisaRaw !== null && ANVISA_PATTERN.test(anvisaRaw) ? anvisaRaw : null;
    if (anvisaRaw !== null && anvisaRegister === null)
      w.push(`cProdANVISA inválido "${anvisaRaw}" (esperado 11 ou 13 dígitos, ou ISENTO): não gravado`);
    const pmcRaw = med ? text(med.vPMC) : null;
    const pmc = pmcRaw !== null && PMC_PATTERN.test(pmcRaw) ? new Prisma.Decimal(pmcRaw) : null;
    if (pmcRaw !== null && pmc === null) w.push(`vPMC inválido "${pmcRaw}": não gravado`);
    const exemptionReason = med ? text(med.xMotivoIsencao) : null; // opcional no XSD (1 a 255 caracteres)

    // Bonificação na linha: CFOP 5910, ou ausência de vItem (tag) com vProd > 0.
    const isBonus = cfop === BONUS_CFOP || (vItemAbsent && productsValue !== null && productsValue.gt(0));
    const lineNumber = (nItemAttr ?? nItemEl) ?? '';
    if (cfop === BONUS_CFOP)
      w.push(`Linha ${lineNumber} (EAN ${text(prod.cEAN) ?? 's/EAN'}) identificada como bonificação pelo CFOP 5910`);

    return {
      lineNumber,
      nItemFromAttribute: nItemAttr !== null,
      supplierProductCode: text(prod.cProd),
      ean: text(prod.cEAN),
      description: text(prod.xProd),
      ncm: text(prod.NCM),
      unit: text(prod.uCom),
      cfop,
      quantity,
      unitCostExtracted: dec(prod.vUnCom),
      unitCostPaid,
      totalLine,
      productsValue,
      discount: dec(prod.vDesc),
      otherExpense: dec(prod.vOutro),
      lots,
      anvisaRegister,
      anvisaExemptionReason: exemptionReason,
      pmc,
      isBonus,
      warnings: w,
    };
  });

  const total = ((inf.total as Record<string, unknown> | undefined)?.ICMSTot ?? {}) as Record<string, unknown>;
  const fiscalTotal = dec(total.vNF);
  // vOrig da fatura (cobr/fat/vOrig): valor efetivamente cobrado, distinto do total fiscal.
  const cobr = (inf.cobr ?? {}) as Record<string, unknown>;
  const fat = (cobr.fat ?? {}) as Record<string, unknown>;
  const paymentAmountInDocument = dec(fat.vOrig);

  const bonusLines = lines.filter((l) => l.isBonus);
  const bonusAmount = bonusLines.length
    ? bonusLines.reduce((s, l) => s.plus(l.productsValue ?? money('0')), money('0'))
    : null;
  const paidAmount = fiscalTotal !== null && bonusAmount !== null ? fiscalTotal.minus(bonusAmount) : null;

  const textBonus = infCpl !== null && BONUS_TEXT.test(infCpl);
  const invoiceBonus =
    paymentAmountInDocument !== null && fiscalTotal !== null && !paymentAmountInDocument.equals(fiscalTotal);
  const hasBonus = bonusLines.length > 0 || textBonus || invoiceBonus;
  if (invoiceBonus)
    warnings.push(
      `Valor de fatura (R$ ${paymentAmountInDocument!.toString()}) difere do total da NF-e (R$ ${fiscalTotal!.toString()}): possível bonificação de R$ ${fiscalTotal!.minus(paymentAmountInDocument!).toString()}`,
    );
  if (textBonus && bonusLines.length === 0)
    warnings.push('Texto de bonificação no documento (FORNEC BONIFIC) sem linha CFOP 5910 — rever manualmente');

  return {
    source: 'XML',
    invoiceNumber: text(ide.nNF),
    invoiceSeries: text(ide.serie),
    invoiceKey: text(inf['@_Id'])?.replace(/^NFe/, '') ?? null,
    issuerCnpj: text((inf.emit as Record<string, unknown> | undefined)?.CNPJ),
    recipientCnpj: text((inf.dest as Record<string, unknown> | undefined)?.CNPJ),
    issuedAt,
    fiscalTotal,
    productsTotal: dec(total.vProd),
    discounts: dec(total.vDesc),
    otherExpenses: dec(total.vOutro),
    paymentAmountInDocument,
    hasBonus,
    bonusAmount,
    paidAmount,
    lines,
    warnings,
  };
}
