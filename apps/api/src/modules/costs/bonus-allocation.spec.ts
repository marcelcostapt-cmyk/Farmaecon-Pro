import { money } from './cost-money';
import {
  applyBonusAllocation,
  type BonusAllocationLine,
  type BonusDecision,
} from './bonus-allocation';

const line = (over: Partial<BonusAllocationLine> & { lineNumber: string }): BonusAllocationLine => ({
  ean: null,
  marketplaceSku: null,
  supplierCode: null,
  quantity: money('10'),
  totalLine: money('100'),
  isBonus: false,
  bonusQuantity: money('0'),
  ...over,
});

const byLine = (results: { lineNumber: string }[], n: string) => results.find((r) => r.lineNumber === n)!;

describe('applyBonusAllocation', () => {
  it('PROPORTIONAL (§H): custo = (totalLinha + bónus rateado) ÷ quantidade', () => {
    const lines = [
      line({ lineNumber: '1', totalLine: money('100'), quantity: money('10') }),
      line({ lineNumber: '2', totalLine: money('300'), quantity: money('10') }),
    ];
    const decision: BonusDecision = { hasBonus: true, bonusAmount: money('40'), rule: 'PROPORTIONAL' };
    const r = applyBonusAllocation(lines, money('400'), decision);
    expect(byLine(r, '1').allocatedBonus.toString()).toBe('10');
    expect(byLine(r, '1').unitCostApproved!.toString()).toBe('11');
    expect(byLine(r, '2').allocatedBonus.toString()).toBe('30');
    expect(byLine(r, '2').unitCostApproved!.toString()).toBe('33');
  });

  it('IGNORE: allocatedBonus 0; linha bonificada fica sem custo; paga = totalLinha ÷ quantidade', () => {
    const lines = [
      line({ lineNumber: '1', totalLine: money('100'), quantity: money('10') }),
      line({ lineNumber: '2', totalLine: money('0'), quantity: money('2'), isBonus: true, bonusQuantity: money('2') }),
    ];
    const decision: BonusDecision = { hasBonus: true, bonusAmount: money('0'), rule: 'IGNORE' };
    const r = applyBonusAllocation(lines, money('100'), decision);
    expect(byLine(r, '1').allocatedBonus.toString()).toBe('0');
    expect(byLine(r, '1').unitCostApproved!.toString()).toBe('10');
    expect(byLine(r, '2').allocatedBonus.toString()).toBe('0');
    expect(byLine(r, '2').unitCostApproved).toBeNull();
    expect(byLine(r, '2').bonusQuantity.toString()).toBe('2');
  });

  it('SPECIFIC_SKU: toda a bonificação na linha alvo; outras allocatedBonus 0', () => {
    const lines = [
      line({ lineNumber: '1', ean: '111', totalLine: money('100'), quantity: money('10') }),
      line({ lineNumber: '2', ean: '222', totalLine: money('100'), quantity: money('5') }),
    ];
    const decision: BonusDecision = { hasBonus: true, bonusAmount: money('50'), rule: 'SPECIFIC_SKU', specificSkuEan: '222' };
    const r = applyBonusAllocation(lines, money('200'), decision);
    expect(byLine(r, '1').allocatedBonus.toString()).toBe('0');
    expect(byLine(r, '1').unitCostApproved!.toString()).toBe('10');
    expect(byLine(r, '2').allocatedBonus.toString()).toBe('50');
    expect(byLine(r, '2').unitCostApproved!.toString()).toBe('30');
  });

  it('SPECIFIC_SKU com EAN inexistente lança erro claro', () => {
    const lines = [line({ lineNumber: '1', ean: '111' })];
    const decision: BonusDecision = { hasBonus: true, bonusAmount: money('50'), rule: 'SPECIFIC_SKU', specificSkuEan: '999' };
    expect(() => applyBonusAllocation(lines, money('100'), decision)).toThrow(/não encontr/i);
  });

  it('hasBonus=true sem bonusAmount>0 lança "valor obrigatório"', () => {
    const lines = [line({ lineNumber: '1' })];
    const decision: BonusDecision = { hasBonus: true, bonusAmount: money('0'), rule: 'PROPORTIONAL' };
    expect(() => applyBonusAllocation(lines, money('100'), decision)).toThrow(/obrigatór/i);
  });

  it('bonusAmount negativo lança', () => {
    const lines = [line({ lineNumber: '1' })];
    const decision: BonusDecision = { hasBonus: true, bonusAmount: money('-5'), rule: 'PROPORTIONAL' };
    expect(() => applyBonusAllocation(lines, money('100'), decision)).toThrow(/negativ/i);
  });

  it('manualUnitCost sobrepõe o custo calculado da linha', () => {
    const lines = [
      line({ lineNumber: '1', totalLine: money('100'), quantity: money('10') }),
      line({ lineNumber: '2', totalLine: money('300'), quantity: money('10') }),
    ];
    const decision: BonusDecision = {
      hasBonus: true, bonusAmount: money('40'), rule: 'PROPORTIONAL',
      manual: { '1': money('7.5') },
    };
    const r = applyBonusAllocation(lines, money('400'), decision);
    expect(byLine(r, '1').unitCostApproved!.toString()).toBe('7.5');
    expect(byLine(r, '2').unitCostApproved!.toString()).toBe('33');
  });

  it('quantidade 0 → unitCostApproved null (nunca divisão por zero nem custo fabricado)', () => {
    const lines = [line({ lineNumber: '1', totalLine: money('100'), quantity: money('0') })];
    const decision: BonusDecision = { hasBonus: false, bonusAmount: money('0'), rule: 'IGNORE' };
    const r = applyBonusAllocation(lines, money('100'), decision);
    expect(byLine(r, '1').unitCostApproved).toBeNull();
  });
});
