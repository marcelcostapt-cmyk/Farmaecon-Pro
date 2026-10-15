import { ConfigService } from '@nestjs/config';
import { MarketplacePlatform } from '@prisma/client';
import { MlApiService } from './ml-api.service';

describe('MlApiService bounded order windows', () => {
  function setup() {
    const prisma = {
      marketplaceAccount: {
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 'account-a',
          platform: MarketplacePlatform.MERCADO_LIVRE,
          externalSellerId: 'seller-a',
          accessToken: 'encrypted-fixture',
        }),
      },
    };
    const http = {
      request: jest.fn().mockImplementation(async (url: URL) => ({
        ok: true,
        status: 200,
        json: async () => ({
          paging: {
            total: Number(url.searchParams.get('offset')) === 0 ? 0 : 50,
            offset: Number(url.searchParams.get('offset')),
            limit: 50,
          },
          results: [],
        }),
      })),
    };
    const vault = { decrypt: jest.fn().mockReturnValue('access-fixture') };
    const oauth = { refreshToken: jest.fn() };
    const service = new MlApiService(
      new ConfigService(),
      prisma as any,
      oauth as any,
      vault as any,
      http as any,
    );
    return { service, http };
  }

  it('sends date_closed bounds while preserving seller, sort and pagination', async () => {
    const { service, http } = setup();
    await service.listSellerOrdersPageInWindow('account-a', 'tenant-a', {
      offset: 50,
      limit: 50,
      windowFrom: new Date('2026-10-03T20:00:00.000Z'),
      windowTo: new Date('2026-10-04T03:00:00.000Z'),
    });

    const url = http.request.mock.calls[0][0] as URL;
    expect(url.pathname).toBe('/orders/search');
    expect(url.searchParams.get('seller')).toBe('seller-a');
    expect(url.searchParams.get('offset')).toBe('50');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('sort')).toBe('date_desc');
    expect(url.searchParams.get('order.date_closed.from')).toBe('2026-10-03T20:00:00.000Z');
    expect(url.searchParams.get('order.date_closed.to')).toBe('2026-10-04T03:00:00.000Z');
  });

  it('keeps the existing unbounded page method compatible', async () => {
    const { service, http } = setup();
    await service.listSellerOrdersPage('account-a', 'tenant-a', { offset: 0, limit: 50 });
    const url = http.request.mock.calls[0][0] as URL;
    expect(url.searchParams.get('sort')).toBe('date_desc');
    expect(url.searchParams.get('order.date_closed.from')).toBeNull();
    expect(url.searchParams.get('order.date_closed.to')).toBeNull();
  });

  it.each([40, 0])('exposes a valid reduced total %i for recovery when the cursor is beyond it', async total => {
    const { service, http } = setup();
    http.request.mockResolvedValue({ ok: true, status: 200, json: async () => ({
      paging: { total, offset: 50, limit: 50 }, results: [],
    }) });
    await expect(service.listSellerOrdersPageInWindow('account-a', 'tenant-a', {
      offset: 50, windowFrom: new Date('2026-10-03T20:00:00Z'), windowTo: new Date('2026-10-04T03:00:00Z'),
    })).rejects.toMatchObject({ message: 'Order pagination total changed during synchronization', total });
  });

  it.each([
    { total: -1, offset: 50 }, { total: 40.5, offset: 50 }, { total: 40, offset: 0 },
  ])('does not reinterpret malformed pagination as a recoverable total change: %j', async paging => {
    const { service, http } = setup();
    http.request.mockResolvedValue({ ok: true, status: 200, json: async () => ({ paging, results: [] }) });
    await expect(service.listSellerOrdersPageInWindow('account-a', 'tenant-a', {
      offset: 50, windowFrom: new Date('2026-10-03T20:00:00Z'), windowTo: new Date('2026-10-04T03:00:00Z'),
    })).rejects.toThrow('Incomplete or inconsistent order pagination');
  });
});
