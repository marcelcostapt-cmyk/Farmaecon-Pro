import { Prisma } from '@prisma/client';

export const publicAccountSelect = {
  id: true, name: true, platform: true, status: true, createdAt: true,
} satisfies Prisma.MarketplaceAccountSelect;
export const publicOrderSelect = {
  id: true, externalOrderId: true, totalAmount: true, status: true, createdAt: true,
  marketplaceAccount: { select: publicAccountSelect },
  financialTransactions: { select: {
    id: true, amount: true, type: true, description: true, date: true,
  } },
} satisfies Prisma.OrderSelect;
