import { Prisma } from '@prisma/client';

// Conta resumida para listagens (ex.: pedidos): sem identidade fiscal nem ID de vendedor,
// porque a lista de pedidos só mostra nome e plataforma.
export const orderAccountSelect = {
  id: true, name: true, platform: true, status: true, createdAt: true,
} satisfies Prisma.MarketplaceAccountSelect;
// Conta completa para a área de integrações (edição de identidade fiscal e nome amigável).
export const publicAccountSelect = {
  ...orderAccountSelect, displayName: true, externalSellerId: true, businessName: true, cnpj: true,
} satisfies Prisma.MarketplaceAccountSelect;
export const publicOrderSelect = {
  id: true, externalOrderId: true, totalAmount: true, status: true, createdAt: true,
  marketplaceAccount: { select: orderAccountSelect },
  financialTransactions: { select: {
    id: true, amount: true, type: true, description: true, date: true,
  } },
} satisfies Prisma.OrderSelect;
