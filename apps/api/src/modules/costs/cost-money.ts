import { Prisma } from '@prisma/client';

/** Parse a value into an exact decimal. Never use JS number arithmetic for money. */
export function money(value: string | number | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** Sum decimals exactly (no floating-point error). */
export function sumCents(items: Prisma.Decimal[]): Prisma.Decimal {
  return items.reduce((acc, d) => acc.plus(d), new Prisma.Decimal(0));
}
