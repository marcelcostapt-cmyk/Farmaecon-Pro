import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNfeXml } from './nfe-xml-parser';

const xml = readFileSync(join(__dirname, '../../../test/fixtures/nfe-belajoyce.xml'));

describe('parseNfeXml — NF-e Belajoyce (valores documentados)', () => {
  const inv = parseNfeXml(xml);

  it('extracts header: number, series, issue date, totals', () => {
    expect(inv.source).toBe('XML');
    expect(inv.invoiceNumber).toBe('1926966');
    expect(inv.invoiceSeries).toBe('20');
    expect(inv.issuedAt?.toISOString().slice(0, 10)).toBe('2026-11-10');
    expect(inv.productsTotal!.equals(new Prisma.Decimal('16630.97'))).toBe(true);
    expect(inv.fiscalTotal!.equals(new Prisma.Decimal('16630.97'))).toBe(true); // vNF
    expect(inv.paymentAmountInDocument!.equals(new Prisma.Decimal('8315.96'))).toBe(true); // vOrig da fatura
  });

  it('detecta bonificação: fatura ≠ total, linha CFOP 5910, valor pago vs bonificado', () => {
    expect(inv.hasBonus).toBe(true);
    expect(inv.bonusAmount!.equals(new Prisma.Decimal('8315.01'))).toBe(true); // vProd do item 4
    expect(inv.paidAmount!.equals(new Prisma.Decimal('8315.96'))).toBe(true); // fiscal - bonificação
    expect(inv.lines[3].isBonus).toBe(true);
    expect(inv.lines[0].isBonus).toBe(false);
    expect(inv.warnings.some((w) => /difere do total da NF-e/i.test(w))).toBe(true);
    expect(inv.lines[3].warnings.some((w) => /CFOP 5910/.test(w))).toBe(true);
  });

  it('extracts 4 lines, 3 distinct EANs, 1182 commercial units', () => {
    expect(inv.lines).toHaveLength(4);
    expect(new Set(inv.lines.map((l) => l.ean)).size).toBe(3);
    const units = inv.lines.reduce((s, l) => s.plus(l.quantity), new Prisma.Decimal(0));
    expect(units.equals(new Prisma.Decimal('1182'))).toBe(true);
    expect(inv.lines[0].ean).toBe('7897947606517'); // preserved as text
  });

  it('line 4 has no vItem but keeps vProd 8315.01 and CFOP 5910, with a warning', () => {
    const l4 = inv.lines[3];
    expect(l4.totalLine).toBeNull();
    expect(l4.productsValue!.equals(new Prisma.Decimal('8315.01'))).toBe(true);
    expect(l4.cfop).toBe('5910');
    expect(l4.warnings.some((w) => /vItem/i.test(w))).toBe(true);
  });

  it('reads nItem as a child element (not attribute) and line 3 has two lots', () => {
    expect(inv.lines[0].lineNumber).toBe('1');
    expect(inv.lines[0].nItemFromAttribute).toBe(false);
    expect(inv.lines[2].lots).toHaveLength(2);
    const lot3 = inv.lines[2].lots.reduce((s, x) => s.plus(x.quantity), new Prisma.Decimal(0));
    expect(lot3.equals(new Prisma.Decimal('250'))).toBe(true); // 58 + 192
  });
});
