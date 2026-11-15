import { Prisma } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';
import { money } from './cost-money';

export interface ParsedInvoiceLine {
  lineNumber: string;
  nItemFromAttribute: boolean;
  supplierProductCode: string | null;
  ean: string | null;
  description: string | null;
  quantity: Prisma.Decimal;
  unitCostExtracted: Prisma.Decimal | null;
  totalLine: Prisma.Decimal | null;
  productsValue: Prisma.Decimal | null;
  cfop: string | null;
  lots: Array<{ lot: string | null; quantity: Prisma.Decimal }>;
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
  productsTotal: Prisma.Decimal | null;
  paymentAmountInDocument: Prisma.Decimal | null;
  lines: ParsedInvoiceLine[];
  warnings: string[];
}

const arr = <T>(x: T | T[] | undefined | null): T[] => (Array.isArray(x) ? x : x == null ? [] : [x]);
const text = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
const dec = (v: unknown): Prisma.Decimal | null => { const s = text(v); return s === null ? null : money(s); };

// Non-validating parse: external entities / DTD are not resolved (XXE-safe); values kept as
// strings so EANs keep leading zeros and money keeps full precision until an explicit Decimal.
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, processEntities: false, trimValues: true });

export function parseNfeXml(buffer: Buffer | string): ParsedInvoice {
  const root = parser.parse(buffer.toString('utf8'));
  const inf = root?.nfeProc?.NFe?.infNFe ?? root?.NFe?.infNFe;
  if (!inf) throw new Error('XML não é uma NF-e reconhecível (infNFe ausente)');
  const ide = inf.ide ?? {};
  const warnings: string[] = [];
  const dhEmi = text(ide.dhEmi ?? ide.dEmi);
  const issuedAt = dhEmi ? new Date(dhEmi) : null;
  if (dhEmi && !(issuedAt && Number.isFinite(issuedAt.getTime()))) warnings.push('Data de emissão inválida');

  const lines: ParsedInvoiceLine[] = arr(inf.det).map((det: Record<string, unknown>) => {
    const prod = (det.prod ?? {}) as Record<string, unknown>;
    const nItemAttr = text(det['@_nItem']);
    const nItemEl = text(det.nItem);
    const w: string[] = [];
    const totalLine = dec(det.vItem);
    const productsValue = dec(prod.vProd);
    if (totalLine === null && productsValue !== null) w.push('vItem ausente na linha; usado vProd');
    const lots = arr(prod.rastro as Record<string, unknown> | Record<string, unknown>[])
      .map((r) => ({ lot: text(r.nLote), quantity: dec(r.qLote) ?? money('0') }));
    return {
      lineNumber: (nItemAttr ?? nItemEl) ?? '',
      nItemFromAttribute: nItemAttr !== null,
      supplierProductCode: text(prod.cProd),
      ean: text(prod.cEAN),
      description: text(prod.xProd),
      quantity: dec(prod.qCom) ?? money('0'),
      unitCostExtracted: dec(prod.vUnCom),
      totalLine, productsValue,
      cfop: text(prod.CFOP),
      lots, warnings: w,
    };
  });

  const total = (inf.total?.ICMSTot ?? {}) as Record<string, unknown>;
  return {
    source: 'XML',
    invoiceNumber: text(ide.nNF),
    invoiceSeries: text(ide.serie),
    invoiceKey: text(inf['@_Id'])?.replace(/^NFe/, '') ?? null,
    issuerCnpj: text((inf.emit as Record<string, unknown> | undefined)?.CNPJ),
    recipientCnpj: text((inf.dest as Record<string, unknown> | undefined)?.CNPJ),
    issuedAt,
    productsTotal: dec(total.vProd),
    paymentAmountInDocument: dec(total.vNF),
    lines, warnings,
  };
}
