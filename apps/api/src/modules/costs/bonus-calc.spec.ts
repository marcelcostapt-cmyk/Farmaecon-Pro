import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNfeXml } from './nfe-xml-parser';
import { computeBonusCalculations } from './bonus-calc';

const dir = join(__dirname, '../../../test/fixtures');
const parse = (name: string) => parseNfeXml(readFileSync(join(dir, name)));
const cand = (calc: ReturnType<typeof computeBonusCalculations>[number], rule: string) =>
  calc.candidates.find((c) => c.rule === rule)!;

describe('computeBonusCalculations — custo médio da bonificação (pendente)', () => {
  it('não gera cálculo quando não há bonificação (NF 193261)', () => {
    expect(computeBonusCalculations(parse('nfe-193261.xml'))).toHaveLength(0);
  });

  it('NF 1926966 (Belajoyce): EAN pago+bonificado — candidatos lado a lado, nenhum aprovado', () => {
    const calcs = computeBonusCalculations(parse('nfe-belajoyce.xml'));
    const g = calcs.find((c) => c.ean === '7897947607996')!;
    expect(g).toBeDefined();
    expect(g.paidQuantity.equals(new Prisma.Decimal('1'))).toBe(true);
    expect(g.bonusQuantity.equals(new Prisma.Decimal('681'))).toBe(true);
    expect(g.totalPaid.equals(new Prisma.Decimal('13.46'))).toBe(true);
    expect(g.totalBonus.equals(new Prisma.Decimal('8315.01'))).toBe(true);
    expect(g.status).toBe('estimado / pendente de aprovação');
    // valor nominal: (13.46 + 8315.01) / 682
    expect(cand(g, 'rateio_proporcional_valor_nominal').unitCost!.toDP(6).toString())
      .toBe(new Prisma.Decimal('8328.47').div(682).toDP(6).toString());
    // dilui custo: 13.46 / 682
    expect(cand(g, 'bonificacao_dilui_custo').unitCost!.toDP(6).toString())
      .toBe(new Prisma.Decimal('13.46').div(682).toDP(6).toString());
    // sem custo: 13.46 / 1
    expect(cand(g, 'bonificacao_sem_custo').unitCost!.equals(new Prisma.Decimal('13.46'))).toBe(true);
  });

  it('NF 1885505: item 15 só bonificado (sem par pago) — nunca custo zero', () => {
    const calcs = computeBonusCalculations(parse('nfe-1885505.xml'));
    const g = calcs.find((c) => c.ean === '7897947606500')!;
    expect(g.paidQuantity.isZero()).toBe(true);
    expect(g.bonusQuantity.equals(new Prisma.Decimal('73'))).toBe(true);
    // valor nominal existe (1094.27/73 = 14.99); dilui e sem-custo ficam indisponíveis (não zero)
    expect(cand(g, 'rateio_proporcional_valor_nominal').unitCost!.equals(new Prisma.Decimal('14.99'))).toBe(true);
    expect(cand(g, 'bonificacao_dilui_custo').unitCost).toBeNull();
    expect(cand(g, 'bonificacao_sem_custo').unitCost).toBeNull();
  });
});
