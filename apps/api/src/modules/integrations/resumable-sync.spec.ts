import { MemoryPrisma } from '../../../test/memory-prisma';
import { MlOrdersSyncService } from './ml-orders-sync.service';

function makePage(offset: number, total: number, pageSize = 50) {
  const count = Math.min(pageSize, Math.max(total - offset, 0));
  const results = Array.from({ length: count }, (_, index) => ({
    id: offset + index + 1,
    status: 'paid',
    total_amount: 10 + index,
    date_created: new Date(Date.UTC(2026, 0, 1, 0, 0, offset + index)).toISOString(),
  }));
  return {
    results,
    offset,
    limit: pageSize,
    total,
    nextOffset: offset + count,
    complete: offset + count >= total,
  };
}

describe('resumable read-only order synchronization', () => {
  function setup(total = 120) {
    const db = new MemoryPrisma();
    db.rows.marketplaceAccount.push({
      id: 'account-a',
      tenantId: 'tenant-a',
      platform: 'MERCADO_LIVRE',
      source: 'MERCADO_LIVRE',
      name: 'Seller A',
      status: 'ACTIVE',
      lastSyncedAt: null,
    });
    const mlApi = {
      listSellerOrdersPage: jest.fn(async (_accountId: string, _tenantId: string, options: { offset?: number }) =>
        makePage(options.offset ?? 0, total)),
    };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const service = new MlOrdersSyncService(db as any, mlApi as any, queue as any);
    return { db, mlApi, queue, service };
  }

  it('persists one page, resumes, completes and remains idempotent', async () => {
    const { db, mlApi, queue, service } = setup();

    const first = await service.syncRecentOrders('account-a', 'tenant-a');
    expect(first.status).toBe('PARTIAL');
    expect(first.nextOffset).toBe(50);
    expect(db.rows.order).toHaveLength(50);
    expect(db.rows.marketplaceSyncState[0]).toMatchObject({ status: 'PARTIAL', nextOffset: 50, expectedTotal: 120 });

    const second = await service.syncRecentOrders('account-a', 'tenant-a');
    expect(second.status).toBe('PARTIAL');
    expect(second.nextOffset).toBe(100);
    expect(db.rows.order).toHaveLength(100);

    const third = await service.syncRecentOrders('account-a', 'tenant-a');
    expect(third.status).toBe('COMPLETE');
    expect(third.importedCount).toBe(120);
    expect(third.nextOffset).toBe(120);
    expect(db.rows.order).toHaveLength(120);
    expect(db.rows.marketplaceAccount[0].lastSyncedAt).toBeInstanceOf(Date);
    expect(new Set(db.rows.order.map((order) => order.externalOrderId)).size).toBe(120);
    expect(mlApi.listSellerOrdersPage.mock.calls.map((call) => call[2].offset)).toEqual([0, 50, 100]);
    expect(queue.add).toHaveBeenCalledTimes(2);

    // A complete re-run starts a fresh pass but does not create duplicates.
    await service.syncRecentOrders('account-a', 'tenant-a');
    await service.syncRecentOrders('account-a', 'tenant-a');
    await service.syncRecentOrders('account-a', 'tenant-a');
    expect(db.rows.order).toHaveLength(120);
    expect(new Set(db.rows.order.map((order) => order.externalOrderId)).size).toBe(120);
  });

  it('keeps the committed cursor when a page fails and resumes from it', async () => {
    const { db, mlApi, service } = setup();
    let failNextPage = true;
    mlApi.listSellerOrdersPage.mockImplementation(async (_accountId: string, _tenantId: string, options: { offset?: number }) => {
      const offset = options.offset ?? 0;
      if (offset === 50 && failNextPage) {
        failNextPage = false;
        throw new Error('Order pagination ended before complete coverage');
      }
      return makePage(offset, 80);
    });

    await service.syncRecentOrders('account-a', 'tenant-a');
    await expect(service.syncRecentOrders('account-a', 'tenant-a')).rejects.toThrow('pagination');
    expect(db.rows.order).toHaveLength(50);
    expect(db.rows.marketplaceSyncState[0]).toMatchObject({ status: 'FAILED', nextOffset: 50, lastError: 'PAGINATION_INCOMPLETE' });

    const resumed = await service.syncRecentOrders('account-a', 'tenant-a');
    expect(resumed.status).toBe('COMPLETE');
    expect(resumed.importedCount).toBe(80);
    expect(resumed.nextOffset).toBe(80);
    expect(db.rows.order).toHaveLength(80);
    expect(mlApi.listSellerOrdersPage.mock.calls.map((call) => call[2].offset)).toEqual([0, 50, 50]);
  });

  it('keeps independent cursors and coverage for each account', async () => {
    const db = new MemoryPrisma();
    for (const [id, total] of [['account-a', 60], ['account-b', 110]] as const) {
      db.rows.marketplaceAccount.push({
        id,
        tenantId: 'tenant-a',
        platform: 'MERCADO_LIVRE',
        source: 'MERCADO_LIVRE',
        name: id,
        status: 'ACTIVE',
        lastSyncedAt: null,
      });
      (db as any)[`total_${id}`] = total;
    }
    const mlApi = {
      listSellerOrdersPage: jest.fn(async (accountId: string, _tenantId: string, options: { offset?: number }) =>
        makePage(options.offset ?? 0, (db as any)[`total_${accountId}`])),
    };
    const service = new MlOrdersSyncService(db as any, mlApi as any, { add: jest.fn() } as any);

    await service.syncRecentOrders('account-a', 'tenant-a');
    await service.syncRecentOrders('account-b', 'tenant-a');

    expect(db.rows.marketplaceSyncState).toEqual(expect.arrayContaining([
      expect.objectContaining({ marketplaceAccountId: 'account-a', nextOffset: 50, expectedTotal: 60, importedCount: 50 }),
      expect.objectContaining({ marketplaceAccountId: 'account-b', nextOffset: 50, expectedTotal: 110, importedCount: 50 }),
    ]));
    expect(mlApi.listSellerOrdersPage.mock.calls.map((call) => [call[0], call[2].offset])).toEqual([
      ['account-a', 0],
      ['account-b', 0],
    ]);
  });
});
