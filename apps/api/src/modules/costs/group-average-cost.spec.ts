import { Prisma } from '@prisma/client';
import { groupAverageCosts, type GroupCostInput } from './group-average-cost';

const D = (s: string) => new Prisma.Decimal(s);
const line = (over: Partial<GroupCostInput> & Pick<GroupCostInput, 'lineNumber'>): GroupCostInput => ({
  ean: '789', supplierCode: null, quantity: D('1'), totalLine: null, productsValue: null,
  otherExpense: null, icmsSt: null, ipi: null, isBonus: false, ...over,
});

describe('custo médio por grupo (decisão #2: rateio proporcional a valor nominal)', () => {
  it('cenário 1 — bonificação do mesmo EAN: (pago + bonificado) ÷ unidades totais', () => {
    const lines = [
      line({ lineNumber: '1', quantity: D('10'), totalLine: D('100') }), // pago: 10 un, vItem 100
      line({ lineNumber: '2', quantity: D('2'), productsValue: D('20'), isBonus: true }), // bonificado: 2 un, vProd 20, sem vItem
    ];
    const [paid, bonus] = groupAverageCosts(lines, { ipiRecoverable: true });
    expect(paid.unitCost!.toString()).toBe('10');
    expect(bonus.unitCost!.toString()).toBe('10');
    expect(paid.allocatedBonus.plus(bonus.allocatedBonus).toString()).toBe('20'); // bonificação totalmente rateada
    expect(paid.warnings).toEqual([]);
  });

  it('cenário 2 — bonificação de EAN diferente não é rateada', () => {
    const lines = [
      line({ lineNumber: '1', ean: 'AAA', quantity: D('10'), totalLine: D('100') }),
      line({ lineNumber: '2', ean: 'BBB', quantity: D('2'), productsValue: D('20'), isBonus: true }),
    ];
    const [a, b] = groupAverageCosts(lines, { ipiRecoverable: true });
    expect(a.unitCost!.toString()).toBe('10'); // sem a bonificação de B
    expect(a.allocatedBonus.toString()).toBe('0');
    expect(b.unitCost).toBeNull(); // sem par pago do mesmo EAN: nunca custo zero
    expect(b.warnings.some((w) => /sem linha paga do mesmo EAN/.test(w))).toBe(true);
  });

  it('cenário 3 — impostos e despesas: vItem prevalece sobre vProd; vOutro e ST entram; IPI só se não recuperável', () => {
    const lines = [
      line({ lineNumber: '1', quantity: D('10'), totalLine: D('90'), productsValue: D('100'), otherExpense: D('12'), icmsSt: D('8'), ipi: D('10') }),
    ];
    // base não recuperável: 90 (vItem) + 12 (vOutro) + 8 (ST) + 10 (IPI) = 120 → 12 por unidade
    expect(groupAverageCosts(lines, { ipiRecoverable: false })[0].unitCost!.toString()).toBe('12');
    // IPI recuperável não entra: 90 + 12 + 8 = 110 → 11 por unidade
    expect(groupAverageCosts(lines, { ipiRecoverable: true })[0].unitCost!.toString()).toBe('11');
  });

  it('linha sem vItem usa vProd como valor pago', () => {
    const [r] = groupAverageCosts([line({ lineNumber: '1', quantity: D('4'), productsValue: D('40') })], { ipiRecoverable: true });
    expect(r.unitCost!.toString()).toBe('10');
  });

  it('linha sem EAN nem código do fornecedor não tem custo médio', () => {
    const [r] = groupAverageCosts([line({ lineNumber: '1', ean: null, quantity: D('1'), totalLine: D('5') })], { ipiRecoverable: true });
    expect(r.unitCost).toBeNull();
    expect(r.warnings[0]).toMatch(/sem EAN nem código/);
  });

  it('fixture real (NF-e Belajoyce): 1 un. paga (13,46) + 681 un. bonificadas (8315,01) do mesmo EAN', () => {
    const lines = [
      line({ lineNumber: '2', ean: '7897947607996', quantity: D('1'), totalLine: D('13.46'), productsValue: D('13.46') }),
      line({ lineNumber: '4', ean: '7897947607996', quantity: D('681'), productsValue: D('8315.01'), isBonus: true }),
    ];
    const [paid, bonus] = groupAverageCosts(lines, { ipiRecoverable: true });
    const expected = D('8328.47').div(D('682'));
    expect(paid.unitCost!.equals(expected)).toBe(true);
    expect(bonus.unitCost!.equals(expected)).toBe(true);
  });
});
