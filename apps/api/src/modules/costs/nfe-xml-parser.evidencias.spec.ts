import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNfeXml, type ParsedInvoice } from './nfe-xml-parser';

// Fixtures SANITIZADAS (CNPJs/nomes/chaves fictícios) que reproduzem estrutura e valores
// documentados no catálogo de evidências. Validação byte-a-byte dos originais: PENDENTE.
const dir = join(__dirname, '../../../test/fixtures');
const parse = (nNF: string): ParsedInvoice => parseNfeXml(readFileSync(join(dir, `nfe-${nNF}.xml`)));
const D = (v: string) => new Prisma.Decimal(v);
const eq = (a: Prisma.Decimal | null, v: string) => a !== null && a.equals(D(v));

describe('parseNfeXml — catálogo de evidências (10 documentos)', () => {
  it.each([
    // nNF, itens, vProd, vNF, vDesc, vOutro
    ['1885505', 15, '10111.83', '10111.83', null, null],
    ['45468', 3, '2106.50', '2106.50', null, null],
    ['263151', 2, '5016.50', '2212.32', '2804.18', null],
    ['9298845', 1, '2856.60', '1371.17', '1485.43', null],
    ['193261', 1, '3150.00', '3150.00', null, null],
    ['188177', 1, '18363.00', '6977.94', '11385.06', null],
    ['2962607', 3, '1653.70', '1656.89', null, '3.19'],
    ['1309314', 2, '262.28', '264.78', null, '2.50'],
    ['1333570', 9, '3523.32', '3530.82', null, '7.50'],
  ] as const)('NF %s: %i itens e totais (vProd/vNF/vDesc/vOutro)', (nNF, itens, vProd, vNF, vDesc, vOutro) => {
    const inv = parse(nNF);
    expect(inv.lines).toHaveLength(itens);
    expect(eq(inv.productsTotal, vProd)).toBe(true);
    expect(eq(inv.fiscalTotal, vNF)).toBe(true);
    if (vDesc) expect(eq(inv.discounts, vDesc)).toBe(true);
    if (vOutro) expect(eq(inv.otherExpenses, vOutro)).toBe(true);
  });

  it('1885505: item 15 é bonificação CFOP 5910, 73 un em 3 lotes, sem vItem; FORNEC BONIFIC', () => {
    const inv = parse('1885505');
    const l = inv.lines[14];
    expect(l.cfop).toBe('5910');
    expect(l.isBonus).toBe(true);
    expect(l.ean).toBe('7897947606500');
    expect(eq(l.quantity, '73')).toBe(true);
    expect(l.lots).toHaveLength(3);
    expect(l.totalLine).toBeNull(); // sem vItem
    expect(eq(l.productsValue, '1094.27')).toBe(true);
    expect(inv.hasBonus).toBe(true);
    expect(eq(inv.bonusAmount, '1094.27')).toBe(true);
    expect(inv.lines.slice(0, 14).every((x) => !x.isBonus)).toBe(true);
  });

  it('45468: todos os itens têm vItem 0,00 → usa vProd com aviso, não é bonificação; nItem como atributo e elemento', () => {
    const inv = parse('45468');
    expect(inv.lines.every((l) => l.totalLine !== null && l.totalLine.isZero())).toBe(true);
    expect(inv.lines.every((l) => !l.isBonus)).toBe(true);
    expect(inv.lines.every((l) => l.nItemFromAttribute)).toBe(true);
    expect(inv.lines.every((l) => l.warnings.some((w) => /vItem igual a 0,00/i.test(w)))).toBe(true);
    // unitCostPaid cai para vProd/qCom: item 2 = 706.50 / 10 = 70.65
    expect(eq(inv.lines[1].unitCostPaid, '70.65')).toBe(true);
  });

  it.each([
    ['263151', 0, '1956.00', '743.28', '1212.72'],
    ['9298845', 0, '2856.60', '1371.17', '1485.43'],
    ['188177', 0, '18363.00', '6977.94', '11385.06'],
  ] as const)('%s: preserva vProd (bruto) e vItem (líquido) e vDesc da linha', (nNF, idx, vProd, vItem, vDesc) => {
    const l = parse(nNF).lines[idx];
    expect(eq(l.productsValue, vProd)).toBe(true);
    expect(eq(l.totalLine, vItem)).toBe(true);
    expect(eq(l.discount, vDesc)).toBe(true);
  });

  it('193261: caso simples, vProd = vItem = vNF, sem desconto nem bonificação', () => {
    const inv = parse('193261');
    const l = inv.lines[0];
    expect(l.cfop).toBe('5102');
    expect(l.isBonus).toBe(false);
    expect(eq(l.productsValue, '3150.00')).toBe(true);
    expect(eq(l.totalLine, '3150.00')).toBe(true);
    expect(inv.hasBonus).toBe(false);
  });

  it('2962607: vOutro por item (0,84/0,62/1,73) e total; custo pago = vProd + vOutro = vNF', () => {
    const inv = parse('2962607');
    expect(inv.lines.map((l) => l.otherExpense?.toString())).toEqual(['0.84', '0.62', '1.73']);
    expect(eq(inv.otherExpenses, '3.19')).toBe(true);
    expect(inv.productsTotal!.plus(inv.otherExpenses!).equals(inv.fiscalTotal!)).toBe(true);
  });

  it('1309314: vOutro por item e NCM distintos (cosmético 33049910 vs suplemento 21069030)', () => {
    const inv = parse('1309314');
    expect(inv.lines[0].ncm).toBe('33049910');
    expect(inv.lines[1].ncm).toBe('21069030');
    expect(eq(inv.lines[0].otherExpense, '0.54')).toBe(true);
    expect(eq(inv.lines[1].otherExpense, '1.96')).toBe(true);
  });
});
