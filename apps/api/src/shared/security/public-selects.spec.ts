import { OrdersService } from '../../modules/orders/orders.service';
import { orderAccountSelect, publicAccountSelect, publicOrderSelect } from './public-selects';

// Campos de identidade fiscal/vendedor: só devem sair pelo fluxo de integrações (mesmo tenant),
// nunca numa listagem de pedidos.
const IDENTITY_FIELDS = ['displayName', 'externalSellerId', 'businessName', 'cnpj'] as const;

describe('seleções públicas — minimização de dados da conta', () => {
  it('a conta dentro de um pedido não inclui identidade fiscal nem ID de vendedor', () => {
    const accountSelect = publicOrderSelect.marketplaceAccount.select as Record<string, boolean>;
    for (const field of IDENTITY_FIELDS) expect(accountSelect[field]).toBeUndefined();
    expect(accountSelect).toEqual(orderAccountSelect);
  });

  it('a área de integrações mantém os campos de identidade necessários à edição', () => {
    for (const field of IDENTITY_FIELDS) expect(publicAccountSelect[field]).toBe(true);
  });
});

describe('listagem de pedidos — autorização por tenant e seleção', () => {
  it('filtra sempre pelo tenant do pedido e usa a seleção resumida da conta', async () => {
    const prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const service = new OrdersService(prisma as any);

    await service.findAll('tenant-a', { page: 1, limit: 10 });

    const args = prisma.order.findMany.mock.calls[0][0];
    expect(args.where.tenantId).toBe('tenant-a');
    expect(args.select).toBe(publicOrderSelect);
    expect(prisma.order.count.mock.calls[0][0].where.tenantId).toBe('tenant-a');
  });
});
