import type { PrismaService } from '../../shared/prisma/prisma.service';
import { ProductsService } from './products.service';

describe('ProductsService.upsert — registo Anvisa', () => {
  const upsert = jest.fn(async (args: unknown) => args);
  const service = new ProductsService({ product: { upsert } } as unknown as PrismaService);
  const base = { sku: 'SKU-1', title: 'DIPIRONA', costPrice: 10, basePrice: 20 };

  beforeEach(() => upsert.mockClear());

  it('não altera o registo Anvisa quando não é enviado', async () => {
    await service.upsert('t1', base);
    const args = upsert.mock.calls[0][0] as { update: Record<string, unknown> };
    expect(args.update).not.toHaveProperty('anvisaRegister');
  });

  it('grava o registo Anvisa quando é enviado (sem espaços)', async () => {
    await service.upsert('t1', { ...base, anvisaRegister: '  1.0068.0001  ' });
    const args = upsert.mock.calls[0][0] as { update: Record<string, unknown> };
    expect(args.update.anvisaRegister).toBe('1.0068.0001');
  });

  it('string vazia limpa o registo (vira null)', async () => {
    await service.upsert('t1', { ...base, anvisaRegister: '   ' });
    const args = upsert.mock.calls[0][0] as { update: Record<string, unknown> };
    expect(args.update.anvisaRegister).toBeNull();
  });
});
