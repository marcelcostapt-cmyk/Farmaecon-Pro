import { Prisma } from '@prisma/client';
import { money, sumCents } from './cost-money';

describe('cost-money', () => {
  it('money() parses a string to an exact Decimal', () => {
    expect(money('15.53')).toEqual(new Prisma.Decimal('15.53'));
    expect(money('15.53').equals(new Prisma.Decimal('15.53'))).toBe(true);
  });

  it('sumCents() adds without floating-point error', () => {
    // 0.1 + 0.2 must be exactly 0.3, which binary floats cannot do.
    expect(sumCents([money('0.1'), money('0.2')]).equals(new Prisma.Decimal('0.3'))).toBe(true);
    expect(sumCents([]).equals(new Prisma.Decimal('0'))).toBe(true);
  });
});
