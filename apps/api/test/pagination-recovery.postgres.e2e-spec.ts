import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { UnrecoverableError } from 'bullmq';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { inTenant } from '../src/shared/prisma/tenant-context';
import { MlOrdersSyncService } from '../src/modules/integrations/ml-orders-sync.service';
import type { MlApiService, MlOrderPage, MlOrderSearchResult } from '../src/modules/integrations/ml-api.service';

type Provider = Pick<MlApiService, 'listSellerOrdersPageInWindow'>;
const windowFrom = new Date('2026-08-01T00:00:00.000Z');
const windowTo = new Date('2026-09-01T00:00:00.000Z');
const previousBoundary = new Date('2026-07-31T00:00:00.000Z');
const orderDate = '2026-08-15T12:00:00.000Z';

const orders = (count: number): MlOrderSearchResult[] => Array.from({ length: count }, (_, i) => ({
  id: i + 1, status: 'paid', currency_id: 'BRL', total_amount: 10, date_created: orderDate,
}));

function page(snapshot: MlOrderSearchResult[], offset: number, limit = 50): MlOrderPage {
  const results = snapshot.slice(offset, offset + limit);
  return { results, offset, limit, total: snapshot.length, nextOffset: offset + results.length,
    complete: offset + results.length === snapshot.length };
}

describe('PostgreSQL pagination recovery', () => {
  let db: PrismaService;
  let owner: PrismaClient;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://missing');
    if (!['localhost', '127.0.0.1', 'db'].includes(url.hostname) || !url.pathname.includes('test')) {
      throw new Error('A local, explicitly named test database is required');
    }
    const ownerUrl = new URL(process.env.TEST_OWNER_DATABASE_URL ?? 'http://missing');
    if (url.username !== 'farmaecon_runtime' || ownerUrl.hostname !== url.hostname
      || ownerUrl.port !== url.port || ownerUrl.pathname !== url.pathname) {
      throw new Error('Restricted runtime and matching isolated fixture-owner connections are required');
    }
    // Only fixture provisioning/cleanup uses owner. Sync and assertions use runtime with tenant context.
    owner = new PrismaClient({ adapter: new PrismaPg(ownerUrl.toString()) });
    db = new PrismaService();
    await db.onModuleInit();
  }, 30000);

  beforeEach(async () => {
    const prefix = `pagination-${randomUUID()}`;
    tenantA = `${prefix}-a`;
    tenantB = `${prefix}-b`;
    for (const id of [tenantA, tenantB]) await owner.tenant.create({ data: { id, name: id } });
  });

  afterEach(async () => {
    if (owner && tenantA && tenantB) {
      await owner.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    }
  });

  afterAll(async () => {
    try { await db?.$disconnect(); }
    finally { await owner?.$disconnect(); }
  });

  async function fixtureAccount(tenantId: string) {
    const id = randomUUID();
    await owner.marketplaceAccount.create({ data: {
      id, tenantId, platform: 'MERCADO_LIVRE', source: 'MERCADO_LIVRE', name: 'Synthetic page fixture',
      lastSyncedAt: previousBoundary,
    } });
    await owner.marketplaceSyncState.create({ data: {
      tenantId, marketplaceAccountId: id, operation: 'ORDERS', status: 'PARTIAL',
      windowFrom, windowTo, lastSyncedWindowTo: previousBoundary,
    } });
    return id;
  }

  const sync = (provider: Provider, accountId: string, tenantId = tenantA, database = db) =>
    inTenant(tenantId, () => new MlOrdersSyncService(database, provider as MlApiService)
      .syncRecentOrders(accountId, tenantId));

  const stateFor = (accountId: string, tenantId = tenantA) => inTenant(tenantId, () =>
    db.marketplaceSyncState.findUniqueOrThrow({
      where: { tenantId_marketplaceAccountId_operation: { tenantId, marketplaceAccountId: accountId, operation: 'ORDERS' } },
    }));

  const ordersFor = (accountId: string, tenantId = tenantA) => inTenant(tenantId, () =>
    db.order.findMany({ where: { marketplaceAccountId: accountId }, orderBy: { externalOrderId: 'asc' } }));

  const snapshotFor = async (accountId: string, tenantId = tenantA) => ({
    state: await stateFor(accountId, tenantId),
    orders: await ordersFor(accountId, tenantId),
    account: await inTenant(tenantId, () => db.marketplaceAccount.findUniqueOrThrow({ where: { id: accountId } })),
  });

  it('resumes a 120-to-121 restart across services, rejects a stale page and reconciles corrected orders without duplicates', async () => {
    const accountId = await fixtureAccount(tenantA);
    let remote = orders(120);
    const requests: number[] = [];
    let holdNextPage = false;
    let releaseStalePage!: () => void;
    let announceStaleRequest!: () => void;
    const stalePageGate = new Promise<void>(resolve => { releaseStalePage = resolve; });
    const staleRequested = new Promise<void>(resolve => { announceStaleRequest = resolve; });
    const provider: Provider = { async listSellerOrdersPageInWindow(id, tenant, options) {
      expect([id, tenant]).toEqual([accountId, tenantA]);
      expect([options.windowFrom, options.windowTo]).toEqual([windowFrom, windowTo]);
      requests.push(options.offset ?? 0);
      const response = page(remote, options.offset ?? 0, options.limit);
      if (holdNextPage) {
        holdNextPage = false;
        announceStaleRequest();
        await stalePageGate;
      }
      return response;
    } };

    expect(await sync(provider, accountId)).toMatchObject({ status: 'PARTIAL', nextOffset: 50, expectedTotal: 120 });
    const persistedBeforeChange = await ordersFor(accountId);
    expect(persistedBeforeChange).toHaveLength(50);

    // A slow worker has already read offset 50/total 120 when another worker resets the checkpoint.
    holdNextPage = true;
    const staleWork = sync(provider, accountId).then(result => ({ result }), error => ({ error }));
    let staleOutcome: Awaited<typeof staleWork>;
    try {
      await staleRequested;
      // Insertion plus a reversed order moves old page-one records to the last page.
      remote = orders(121).reverse().map(order => order.id === 1 ? {
        ...order, status: 'cancelled', total_amount: 42.42, date_created: '2026-08-14T22:30:00-03:00',
      } : order);
      expect(await sync(provider, accountId)).toMatchObject({ status: 'PARTIAL', nextOffset: 0, expectedTotal: 121 });
    } finally {
      releaseStalePage();
      staleOutcome = await staleWork;
    }
    expect(staleOutcome).toMatchObject({ result: { status: 'PARTIAL', nextOffset: 0, expectedTotal: 121 } });
    expect(await stateFor(accountId)).toMatchObject({
      status: 'PARTIAL', nextOffset: 0, expectedTotal: 121, paginationRestartCount: 1,
      windowFrom, windowTo, lastSyncedWindowTo: previousBoundary,
    });
    expect(await ordersFor(accountId)).toEqual(persistedBeforeChange);

    // Every invocation constructs a fresh service: recovery must come from PostgreSQL.
    expect(await sync(provider, accountId)).toMatchObject({ status: 'PARTIAL', nextOffset: 50, expectedTotal: 121 });
    expect(await sync(provider, accountId)).toMatchObject({ status: 'PARTIAL', nextOffset: 100, expectedTotal: 121 });
    expect(await sync(provider, accountId)).toMatchObject({ status: 'COMPLETE', nextOffset: 121, expectedTotal: 121, importedCount: 121 });
    expect(requests).toEqual([0, 50, 50, 0, 50, 100]);

    const persisted = await ordersFor(accountId);
    expect(persisted).toHaveLength(121);
    expect(new Set(persisted.map(order => order.externalOrderId)).size).toBe(121);
    expect(persisted.map(order => Number(order.externalOrderId)).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 121 }, (_, i) => i + 1));
    expect(persisted.find(order => order.externalOrderId === '1')).toMatchObject({
      totalAmount: 42.42, status: 'CANCELED', createdAt: new Date('2026-08-15T01:30:00.000Z'),
    });
    expect(await stateFor(accountId)).toMatchObject({
      status: 'COMPLETE', paginationRestartCount: 1, nextOffset: 121, expectedTotal: 121,
      importedCount: 121, completedPages: 3, windowFrom, windowTo, lastSyncedWindowTo: windowTo,
    });
  }, 90000);

  it('persists two consecutive total changes before replay and completes idempotently across services', async () => {
    const accountId = await fixtureAccount(tenantA);
    let remote = orders(120);
    const requests: number[] = [];
    const provider: Provider = { async listSellerOrdersPageInWindow(id, tenant, options) {
      expect([id, tenant]).toEqual([accountId, tenantA]);
      expect([options.windowFrom, options.windowTo]).toEqual([windowFrom, windowTo]);
      requests.push(options.offset ?? 0);
      return page(remote, options.offset ?? 0, options.limit);
    } };

    expect(await sync(provider, accountId)).toMatchObject({ status: 'PARTIAL', nextOffset: 50, expectedTotal: 120, importedCount: 50 });
    const committedOrders = await ordersFor(accountId);
    expect(committedOrders).toHaveLength(50);

    remote = orders(121);
    expect(await sync(provider, accountId)).toMatchObject({ status: 'PARTIAL', nextOffset: 0, expectedTotal: 121, importedCount: 50 });
    expect(await stateFor(accountId)).toMatchObject({
      status: 'PARTIAL', paginationRestartCount: 1, nextOffset: 0, expectedTotal: 121,
      importedCount: 50, completedPages: 0, lastError: 'PAGINATION_TOTAL_CHANGED',
      windowFrom, windowTo, lastSyncedWindowTo: previousBoundary,
    });
    expect(await ordersFor(accountId)).toEqual(committedOrders);

    // No successful page separates these changes; each fresh service must read the confirmed total.
    remote = orders(122);
    expect(await sync(provider, accountId)).toMatchObject({ status: 'PARTIAL', nextOffset: 0, expectedTotal: 122, importedCount: 50 });
    expect(await stateFor(accountId)).toMatchObject({
      status: 'PARTIAL', paginationRestartCount: 2, nextOffset: 0, expectedTotal: 122,
      importedCount: 50, completedPages: 0, lastError: 'PAGINATION_TOTAL_CHANGED',
      windowFrom, windowTo, lastSyncedWindowTo: previousBoundary,
    });
    expect(await ordersFor(accountId)).toEqual(committedOrders);

    expect(await sync(provider, accountId)).toMatchObject({ status: 'PARTIAL', nextOffset: 50, importedCount: 50 });
    expect(await sync(provider, accountId)).toMatchObject({ status: 'PARTIAL', nextOffset: 100, importedCount: 100 });
    expect(await sync(provider, accountId)).toMatchObject({ status: 'COMPLETE', nextOffset: 122, expectedTotal: 122, importedCount: 122 });
    expect(requests).toEqual([0, 50, 0, 0, 50, 100]);
    const persisted = await ordersFor(accountId);
    expect(persisted).toHaveLength(122);
    expect(new Set(persisted.map(order => order.externalOrderId)).size).toBe(122);
    expect(persisted.map(order => Number(order.externalOrderId)).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 122 }, (_, i) => i + 1));
    expect(await stateFor(accountId)).toMatchObject({
      status: 'COMPLETE', paginationRestartCount: 2, nextOffset: 122, expectedTotal: 122,
      importedCount: 122, completedPages: 3, lastError: null, windowFrom, windowTo, lastSyncedWindowTo: windowTo,
    });
  }, 90000);

  it('stops after three restarts while preserving another account cursor and the other tenant', async () => {
    const driftingAccount = await fixtureAccount(tenantA);
    const stableAccount = await fixtureAccount(tenantA);
    const foreignAccount = await fixtureAccount(tenantB);
    await owner.order.create({ data: {
      tenantId: tenantB, marketplaceAccountId: foreignAccount, externalOrderId: '1',
      totalAmount: 777.77, status: 'PAID', createdAt: new Date(orderDate),
    } });
    let total = 120;
    let calls = 0;
    const provider: Provider = { async listSellerOrdersPageInWindow(id, tenant, options) {
      expect(tenant).toBe(tenantA);
      if (id !== driftingAccount && id !== stableAccount) throw new Error('Unexpected synthetic account');
      calls++;
      return page(orders(id === driftingAccount ? total : 80), options.offset ?? 0, options.limit);
    } };

    expect(await sync(provider, stableAccount)).toMatchObject({ status: 'PARTIAL', nextOffset: 50, importedCount: 50 });
    const stableBefore = await snapshotFor(stableAccount);
    const foreignBefore = await snapshotFor(foreignAccount, tenantB);

    for (let restart = 1; restart <= 4; restart++) {
      expect(await sync(provider, driftingAccount)).toMatchObject({ status: 'PARTIAL', nextOffset: 50 });
      total++;
      if (restart <= 3) {
        expect(await sync(provider, driftingAccount)).toMatchObject({ status: 'PARTIAL', nextOffset: 0, expectedTotal: total });
        expect(await stateFor(driftingAccount)).toMatchObject({
          paginationRestartCount: restart, nextOffset: 0, expectedTotal: total,
          windowFrom, windowTo, lastSyncedWindowTo: previousBoundary,
        });
      } else {
        await expect(sync(provider, driftingAccount)).rejects.toBeInstanceOf(UnrecoverableError);
      }
    }
    expect(await stateFor(driftingAccount)).toMatchObject({
      status: 'FAILED', paginationRestartCount: 3, nextOffset: 50, expectedTotal: 123,
      windowFrom, windowTo, lastSyncedWindowTo: previousBoundary,
    });
    expect(await ordersFor(driftingAccount)).toHaveLength(50);
    const callsAtFailure = calls;
    await expect(sync(provider, driftingAccount)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(calls).toBe(callsAtFailure);

    expect(await snapshotFor(stableAccount)).toEqual(stableBefore);
    expect(await snapshotFor(foreignAccount, tenantB)).toEqual(foreignBefore);
    expect(await sync(provider, stableAccount)).toMatchObject({ status: 'COMPLETE', nextOffset: 80, importedCount: 80 });
    expect(await stateFor(stableAccount)).toMatchObject({ paginationRestartCount: 0, expectedTotal: 80 });
    expect(await ordersFor(stableAccount)).toHaveLength(80);
  }, 90000);

  it('rolls back the page claim, an updated order and an inserted order when the transaction fails, then retries safely', async () => {
    const accountId = await fixtureAccount(tenantA);
    await owner.order.create({ data: {
      tenantId: tenantA, marketplaceAccountId: accountId, externalOrderId: '1',
      totalAmount: 5, status: 'PAID', createdAt: new Date(orderDate),
    } });
    const originalOrders = await ordersFor(accountId);
    const provider: Provider = { async listSellerOrdersPageInWindow(id, tenant, options) {
      expect([id, tenant, options.offset]).toEqual([accountId, tenantA, 0]);
      return page([
        { id: 1, total_amount: 42.42, currency_id: 'BRL', status: 'cancelled', date_created: orderDate },
        { id: 2, total_amount: 7, currency_id: 'BRL', status: 'paid', date_created: orderDate },
      ], 0);
    } };

    // Inject only the failure; both upserts and the surrounding transaction are real PostgreSQL operations.
    // This leaves production code and RLS unchanged and catches a cursor claim committed separately from its page.
    const failingDb = new Proxy(db, { get(target, property) {
      if (property !== '$transaction') return Reflect.get(target, property);
      return (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(async tx => {
        let writes = 0;
        const failingTx = new Proxy(tx, { get(transaction, key) {
          if (key !== 'order') return Reflect.get(transaction, key);
          return new Proxy(transaction.order, { get(delegate, method) {
            if (method !== 'upsert') return Reflect.get(delegate, method);
            return async (args: Prisma.OrderUpsertArgs) => {
              const result = await delegate.upsert(args);
              if (++writes === 2) throw new Error('Synthetic failure after two real upserts');
              return result;
            };
          } });
        } });
        return operation(failingTx);
      });
    } });

    await expect(sync(provider, accountId, tenantA, failingDb)).rejects.toThrow('Synthetic failure after two real upserts');
    expect(await ordersFor(accountId)).toEqual(originalOrders);
    expect(await stateFor(accountId)).toMatchObject({
      status: 'FAILED', nextOffset: 0, expectedTotal: null, completedPages: 0,
      importedCount: 0, paginationRestartCount: 0, windowFrom, windowTo, lastSyncedWindowTo: previousBoundary,
    });

    expect(await sync(provider, accountId)).toMatchObject({ status: 'COMPLETE', nextOffset: 2, importedCount: 2 });
    expect((await ordersFor(accountId)).map(order => [order.externalOrderId, order.totalAmount, order.status]))
      .toEqual([['1', 42.42, 'CANCELED'], ['2', 7, 'PAID']]);
    expect(await stateFor(accountId)).toMatchObject({
      status: 'COMPLETE', nextOffset: 2, completedPages: 1, paginationRestartCount: 0, lastSyncedWindowTo: windowTo,
    });
  }, 30000);
});
