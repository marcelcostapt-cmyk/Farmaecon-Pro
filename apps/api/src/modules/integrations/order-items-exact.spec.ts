import { MemoryPrisma } from '../../../test/memory-prisma';
import { MlOrdersSyncService } from './ml-orders-sync.service';

// A paid BRL order with a configurable set of sold lines.
function order(items: Array<{ element_id: number; unit_price: number }>) {
  return {
    id: 2001, status: 'paid', total_amount: 100, currency_id: 'BRL',
    date_created: new Date(Date.now() - 3600_000).toISOString(),
    order_items: items.map((i) => ({ element_id: i.element_id, item: { id: `MLB${i.element_id}`, seller_sku: `S${i.element_id}` }, quantity: 1, unit_price: i.unit_price })),
  };
}
function page(results: unknown[]) {
  return { results, offset: 0, total: results.length, nextOffset: results.length, complete: true };
}

function setup() {
  const db = new MemoryPrisma();
  db.rows.marketplaceAccount.push({ id: 'account-a', tenantId: 'tenant-a', platform: 'MERCADO_LIVRE', source: 'MERCADO_LIVRE', name: 'A', status: 'ACTIVE', lastSyncedAt: null });
  const mlApi = { listSellerOrdersPageInWindow: jest.fn() };
  const service = new MlOrdersSyncService(db as never, mlApi as never, { add: jest.fn() } as never);
  return { db, mlApi, service };
}
const itemsOf = (db: MemoryPrisma) => db.rows.orderItem.filter((i) => i.marketplaceAccountId === 'account-a');

describe('order items — exact set per order on re-sync', () => {
  it('removes a line that disappears from a later read instead of leaving it stale', async () => {
    const { db, mlApi, service } = setup();
    mlApi.listSellerOrdersPageInWindow.mockResolvedValueOnce(page([order([{ element_id: 1, unit_price: 10 }, { element_id: 2, unit_price: 5 }])]));
    await service.syncRecentOrders('account-a', 'tenant-a');
    expect(itemsOf(db).map((i) => i.mlElementId).sort()).toEqual(['1', '2']);

    // The order is re-read (incremental sync / backfill) with line 2 gone.
    mlApi.listSellerOrdersPageInWindow.mockResolvedValueOnce(page([order([{ element_id: 1, unit_price: 10 }])]));
    await service.syncRecentOrders('account-a', 'tenant-a');

    expect(itemsOf(db).map((i) => i.mlElementId)).toEqual(['1']); // stale line 2 removed, not left behind
  });
});
