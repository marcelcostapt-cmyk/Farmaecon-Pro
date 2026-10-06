import { MemoryPrisma } from '../../../test/memory-prisma';
import { MlOrdersSyncService } from './ml-orders-sync.service';

describe('Marketplace order data integrity', () => {
  const valid = { id: '123', status: 'paid', total_amount: 125.5, date_created: '2026-09-01T23:30:00-03:00' };
  let db: MemoryPrisma;
  const remote = { listSellerOrdersPageInWindow: jest.fn() };
  let service: MlOrdersSyncService;
  beforeEach(() => {
    jest.clearAllMocks();
    db = new MemoryPrisma();
    db.rows.marketplaceAccount.push({ id: 'account', tenantId: 'tenant', platform: 'MERCADO_LIVRE', source: 'MERCADO_LIVRE', status: 'ACTIVE', lastSyncedAt: null });
    service = new MlOrdersSyncService(db as never, remote as never);
  });
  it.each([
    { ...valid, total_amount: undefined },
    { ...valid, total_amount: Number.NaN },
    { ...valid, total_amount: -1 },
    { ...valid, date_created: 'invalid' },
    { ...valid, date_created: undefined },
    { ...valid, id: '' },
  ])('rejects malformed orders without certifying a successful sync: %j', async order => {
    remote.listSellerOrdersPageInWindow.mockResolvedValue({ results: [order], offset: 0, limit: 50, total: 1, nextOffset: 1, complete: true });
    await expect(service.syncRecentOrders('account', 'tenant')).rejects.toThrow();
    expect(db.rows.order).toHaveLength(0);
    expect(db.rows.marketplaceAccount[0].lastSyncedAt).toBeNull();
  });
  it('preserves provider amounts and date offsets and updates corrected timestamps', async () => {
    remote.listSellerOrdersPageInWindow.mockResolvedValue({ results: [valid], offset: 0, limit: 50, total: 1, nextOffset: 1, complete: true });
    await service.syncRecentOrders('account', 'tenant');
    expect(db.rows.order[0].totalAmount).toBe(125.5);
    expect(db.rows.order[0].createdAt.toISOString()).toBe('2026-09-02T02:30:00.000Z');
    remote.listSellerOrdersPageInWindow.mockResolvedValue({ results: [{ ...valid, date_created: '2026-09-01T22:30:00-03:00' }], offset: 0, limit: 50, total: 1, nextOffset: 1, complete: true });
    await service.syncRecentOrders('account', 'tenant');
    expect(db.rows.order).toHaveLength(1);
    expect(db.rows.order[0].createdAt.toISOString()).toBe('2026-09-02T01:30:00.000Z');
  });
});
