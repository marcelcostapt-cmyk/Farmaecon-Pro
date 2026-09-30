import { ConfigService } from '@nestjs/config';
import { MemoryPrisma } from '../../../test/memory-prisma';
import { MlApiService } from './ml-api.service';
import { MlOrdersSyncService } from './ml-orders-sync.service';
import { validateOrder } from './order-validation';

const valid = { id: 123, total_amount: 19.99, currency_id: 'BRL', date_created: '2026-09-18T23:30:00-03:00', status: 'paid' };
describe('Read-only order data quality', () => {
  it('preserves explicit zero and converts timezone without inventing dates', () => {
    expect(validateOrder({ ...valid, total_amount: 0 }).totalAmount).toBe(0);
    expect(validateOrder(valid).createdAt.toISOString()).toBe('2026-09-19T02:30:00.000Z');
  });
  it.each([{ total_amount: undefined }, { total_amount: NaN }, { total_amount: -1 }, { total_amount: 1.001 },
    { date_created: undefined }, { date_created: '2026-02-30T00:00:00Z' }, { date_created: '2026-09-18' },
    { currency_id: undefined }, { currency_id: 'USD' }, { id: '' }, { id: Number.MAX_SAFE_INTEGER + 1 }])('rejects incomplete or malformed data %j', patch => {
    expect(() => validateOrder({ ...valid, ...patch })).toThrow();
  });
  it('does not write any orders or advance synchronization when a batch is invalid', async () => {
    const db = new MemoryPrisma();
    db.rows.marketplaceAccount.push({ id: 'account', tenantId: 'a', platform: 'MERCADO_LIVRE', status: 'ACTIVE', source: 'MERCADO_LIVRE' });
    const remote = { listSellerOrders: jest.fn().mockResolvedValue([valid, { ...valid, id: 124, total_amount: undefined }]) };
    await expect(new MlOrdersSyncService(db as any, remote as any).syncRecentOrders('account', 'a')).rejects.toThrow();
    expect(db.order.upsert).not.toHaveBeenCalled();
    expect(db.marketplaceAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastSyncState: 'FAILED' }) }));
    expect(db.rows.marketplaceAccount[0].lastSyncedAt).toBeUndefined();
  });
});

describe('Order pagination and token handling', () => {
  const account = { id: 'account', platform: 'MERCADO_LIVRE', externalSellerId: '123', accessToken: 'fixture-encrypted' };
  let http: { request: jest.Mock }; let oauth: { refreshToken: jest.Mock }; let api: MlApiService;
  const page = (offset: number, total: number, ids: number[]) => ({ ok: true, status: 200, json: async () => ({ paging: { offset, total }, results: ids.map(id => ({ ...valid, id })) }) });
  beforeEach(() => {
    http = { request: jest.fn() }; oauth = { refreshToken: jest.fn() };
    api = new MlApiService(new ConfigService(), { marketplaceAccount: { findFirstOrThrow: jest.fn().mockResolvedValue(account) } } as any,
      oauth as any, { decrypt: () => 'fixture-only' } as any, http as any);
  });
  it('fetches every page once and accepts an explicitly empty account', async () => {
    http.request.mockResolvedValueOnce(page(0, 3, [1, 2])).mockResolvedValueOnce(page(2, 3, [3]));
    expect((await api.listSellerOrders('account', 'a', { limit: 2 })).map(o => o.id)).toEqual([1, 2, 3]);
    expect(http.request.mock.calls[1][0].searchParams.get('offset')).toBe('2');
    http.request.mockResolvedValueOnce(page(0, 0, []));
    expect(await api.listSellerOrders('account', 'a')).toEqual([]);
  });
  it.each(['cap', 'duplicate', 'changing-total', 'short-page', 'missing-paging'])('rejects %s instead of reporting partial success', async kind => {
    http.request.mockResolvedValueOnce(page(0, 3, [1, 2]));
    if (kind === 'duplicate') http.request.mockResolvedValueOnce(page(2, 3, [2]));
    if (kind === 'changing-total') http.request.mockResolvedValueOnce(page(2, 4, [3]));
    if (kind === 'short-page') http.request.mockResolvedValueOnce(page(2, 3, []));
    if (kind === 'missing-paging') http.request.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });
    await expect(api.listSellerOrders('account', 'a', { limit: 2, maxPages: kind === 'cap' ? 1 : 2 })).rejects.toThrow();
  });
  it('refreshes once for a 401, and does not treat a 403 as token expiry', async () => {
    http.request.mockResolvedValueOnce({ ok: false, status: 401 }).mockResolvedValueOnce(page(0, 0, []));
    await api.listSellerOrders('account', 'a'); expect(oauth.refreshToken).toHaveBeenCalledTimes(1);
    oauth.refreshToken.mockClear(); http.request.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(api.listSellerOrders('account', 'a')).rejects.toThrow('403'); expect(oauth.refreshToken).not.toHaveBeenCalled();
  });
});
