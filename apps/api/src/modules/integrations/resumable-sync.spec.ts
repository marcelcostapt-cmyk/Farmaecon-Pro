import { UnrecoverableError } from 'bullmq';
import { MemoryPrisma } from '../../../test/memory-prisma';
import { INITIAL_SYNC_WINDOW_DAYS, MlOrdersSyncService } from './ml-orders-sync.service';

function makePage(offset: number, total: number, pageSize = 50) {
  const count = Math.min(pageSize, Math.max(total - offset, 0));
  const results = Array.from({ length: count }, (_, index) => ({
    id: offset + index + 1,
    status: 'paid', currency_id: 'BRL',
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const restartLimitMessage = 'Order pagination total changed during synchronization; restart limit reached';

describe('resumable read-only order synchronization', () => {
  afterEach(() => jest.useRealTimers());

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
      listSellerOrdersPageInWindow: jest.fn(async (_accountId: string, _tenantId: string, options: { offset?: number; windowFrom: Date; windowTo: Date }) =>
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
    expect(db.rows.marketplaceSyncState[0]).toMatchObject({ status: 'PARTIAL', nextOffset: 50, expectedTotal: 120, paginationRestartCount: 0 });

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
    expect(mlApi.listSellerOrdersPageInWindow.mock.calls.map((call) => call[2].offset)).toEqual([0, 50, 100]);
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
    jest.useFakeTimers().setSystemTime(new Date('2026-10-03T22:47:30.000Z'));
    let failNextPage = true;
    const windows: Array<{ from: Date; to: Date }> = [];
    mlApi.listSellerOrdersPageInWindow.mockImplementation(async (_accountId: string, _tenantId: string, options: { offset?: number; windowFrom: Date; windowTo: Date }) => {
      const offset = options.offset ?? 0;
      windows.push({ from: options.windowFrom, to: options.windowTo });
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

    // A retry later keeps the original bounded window, even though the clock moved.
    jest.setSystemTime(new Date('2026-10-04T08:47:30.000Z'));
    const resumed = await service.syncRecentOrders('account-a', 'tenant-a');
    expect(resumed.status).toBe('COMPLETE');
    expect(resumed.importedCount).toBe(80);
    expect(resumed.nextOffset).toBe(80);
    expect(db.rows.order).toHaveLength(80);
    expect(mlApi.listSellerOrdersPageInWindow.mock.calls.map((call) => call[2].offset)).toEqual([0, 50, 50]);
    expect(windows[1]).toEqual(windows[2]);
    expect(windows[1]).toEqual({
      from: new Date('2026-07-05T22:00:00.000Z'),
      to: new Date('2026-10-03T22:00:00.000Z'),
    });
  });

  it.each([121, 80, 40, 0])('restarts the same window when its total changes from 120 to %i without writing the divergent page', async (changedTotal) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-03T22:47:30.000Z'));
    const { db, mlApi, queue, service } = setup(120);
    await service.syncRecentOrders('account-a', 'tenant-a');
    const lastCompletedWindow = new Date('2026-10-02T22:00:00.000Z');
    db.rows.marketplaceSyncState[0].lastSyncedWindowTo = lastCompletedWindow;
    const committedOrders = structuredClone(db.rows.order);
    mlApi.listSellerOrdersPageInWindow.mockResolvedValueOnce(makePage(50, changedTotal));

    const result = await service.syncRecentOrders('account-a', 'tenant-a');

    expect(result).toEqual({ accountId: 'account-a', status: 'PARTIAL', nextOffset: 0, expectedTotal: changedTotal, importedCount: 50 });
    expect(db.rows.order).toEqual(committedOrders);
    expect(db.rows.marketplaceSyncState[0]).toMatchObject({
      status: 'PARTIAL',
      nextOffset: 0,
      expectedTotal: changedTotal,
      importedCount: 50,
      completedPages: 0,
      paginationRestartCount: 1,
      lastError: 'PAGINATION_TOTAL_CHANGED',
      lastSyncedWindowTo: lastCompletedWindow,
      windowFrom: new Date('2026-07-05T22:00:00.000Z'),
      windowTo: new Date('2026-10-03T22:00:00.000Z'),
    });
    expect(db.rows.marketplaceAccount[0]).toMatchObject({ lastSyncState: 'PARTIAL', lastSyncedAt: null });
    expect(mlApi.listSellerOrdersPageInWindow).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
    const secondOptions = mlApi.listSellerOrdersPageInWindow.mock.calls[1][2];
    expect(secondOptions.windowFrom).toEqual(new Date('2026-07-05T22:00:00.000Z'));
    expect(secondOptions.windowTo).toEqual(new Date('2026-10-03T22:00:00.000Z'));
  });

  it('counts a second total change before a successful replay and completes idempotently', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-03T22:47:30.000Z'));
    const { db, mlApi, queue, service } = setup(120);
    let total = 120;
    mlApi.listSellerOrdersPageInWindow.mockImplementation(async (_accountId, _tenantId, options) => makePage(options.offset ?? 0, total));
    await service.syncRecentOrders('account-a', 'tenant-a');
    const lastCompletedWindow = new Date('2026-10-02T22:00:00.000Z');
    db.rows.marketplaceSyncState[0].lastSyncedWindowTo = lastCompletedWindow;
    const committedOrders = structuredClone(db.rows.order);

    total = 121;
    const firstRestart = await service.syncRecentOrders('account-a', 'tenant-a');
    const firstCheckpoint = structuredClone(db.rows.marketplaceSyncState[0]);
    expect(firstCheckpoint).toMatchObject({ paginationRestartCount: 1, nextOffset: 0, completedPages: 0 });
    expect(db.rows.order).toEqual(committedOrders);

    // The next response changes again before any replay page has been committed.
    total = 122;
    const restoredService = new MlOrdersSyncService(db as any, mlApi as any, queue as any);
    const secondRestart = await restoredService.syncRecentOrders('account-a', 'tenant-a');
    expect(db.rows.marketplaceSyncState[0]).toMatchObject({
      status: 'PARTIAL', paginationRestartCount: 2, nextOffset: 0, expectedTotal: 122,
      importedCount: 50, completedPages: 0, lastError: 'PAGINATION_TOTAL_CHANGED',
      windowFrom: new Date('2026-07-05T22:00:00.000Z'),
      windowTo: new Date('2026-10-03T22:00:00.000Z'), lastSyncedWindowTo: lastCompletedWindow,
    });
    expect(secondRestart).toMatchObject({ status: 'PARTIAL', nextOffset: 0, expectedTotal: 122, importedCount: 50 });
    expect(db.rows.order).toEqual(committedOrders);
    expect(firstRestart).toMatchObject({ status: 'PARTIAL', nextOffset: 0, expectedTotal: 121, importedCount: 50 });
    expect(firstCheckpoint).toMatchObject({ expectedTotal: 121 });

    expect(await restoredService.syncRecentOrders('account-a', 'tenant-a')).toMatchObject({ status: 'PARTIAL', nextOffset: 50, importedCount: 50 });
    expect(await restoredService.syncRecentOrders('account-a', 'tenant-a')).toMatchObject({ status: 'PARTIAL', nextOffset: 100, importedCount: 100 });
    expect(await restoredService.syncRecentOrders('account-a', 'tenant-a')).toMatchObject({ status: 'COMPLETE', nextOffset: 122, expectedTotal: 122, importedCount: 122 });
    expect(db.rows.marketplaceSyncState[0]).toMatchObject({
      paginationRestartCount: 2, completedPages: 3, lastError: null,
      lastSyncedWindowTo: new Date('2026-10-03T22:00:00.000Z'),
    });
    expect(db.rows.order).toHaveLength(122);
    expect(new Set(db.rows.order.map(order => order.externalOrderId)).size).toBe(122);
    expect(mlApi.listSellerOrdersPageInWindow.mock.calls.map(call => call[2].offset)).toEqual([0, 50, 0, 0, 50, 100]);
  });

  it('replays from offset zero idempotently and completes after a total change', async () => {
    const { db, mlApi, queue, service } = setup(120);
    await service.syncRecentOrders('account-a', 'tenant-a');
    mlApi.listSellerOrdersPageInWindow.mockImplementation(async (_accountId, _tenantId, options) => makePage(options.offset ?? 0, 80));

    await service.syncRecentOrders('account-a', 'tenant-a');
    const replay = await service.syncRecentOrders('account-a', 'tenant-a');
    expect(replay).toMatchObject({ status: 'PARTIAL', nextOffset: 50, expectedTotal: 80, importedCount: 50 });
    expect(db.rows.marketplaceSyncState[0]).toMatchObject({ paginationRestartCount: 1, completedPages: 1, lastError: null });
    expect(db.rows.order).toHaveLength(50);

    const completed = await service.syncRecentOrders('account-a', 'tenant-a');
    expect(completed).toMatchObject({ status: 'COMPLETE', nextOffset: 80, expectedTotal: 80, importedCount: 80 });
    expect(db.rows.marketplaceSyncState[0]).toMatchObject({ paginationRestartCount: 1, completedPages: 2, lastError: null });
    expect(db.rows.order).toHaveLength(80);
    expect(new Set(db.rows.order.map((order) => order.externalOrderId)).size).toBe(80);
    expect(mlApi.listSellerOrdersPageInWindow.mock.calls.map((call) => call[2].offset)).toEqual([0, 50, 0, 50]);
    expect(queue.add).toHaveBeenCalledTimes(3);
  });

  it('allows the third restart to finish before resetting its budget for the next completed window', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-03T22:47:30.000Z'));
    const { db, mlApi, service } = setup(120);
    let total = 120;
    mlApi.listSellerOrdersPageInWindow.mockImplementation(async (_accountId, _tenantId, options) => makePage(options.offset ?? 0, total));
    await service.syncRecentOrders('account-a', 'tenant-a');

    for (let restart = 1; restart <= 3; restart += 1) {
      total += 1;
      expect(await service.syncRecentOrders('account-a', 'tenant-a')).toMatchObject({ status: 'PARTIAL', nextOffset: 0, expectedTotal: total });
      expect(db.rows.marketplaceSyncState[0]).toMatchObject({ paginationRestartCount: restart, completedPages: 0 });
      await service.syncRecentOrders('account-a', 'tenant-a');
    }
    expect(db.rows.marketplaceSyncState[0]).toMatchObject({ paginationRestartCount: 3, nextOffset: 50, expectedTotal: 123, lastError: null });
    await service.syncRecentOrders('account-a', 'tenant-a');
    expect(await service.syncRecentOrders('account-a', 'tenant-a')).toMatchObject({ status: 'COMPLETE', importedCount: 123 });
    expect(db.rows.marketplaceSyncState[0]).toMatchObject({ paginationRestartCount: 3, lastSyncedWindowTo: new Date('2026-10-03T22:00:00.000Z') });

    jest.setSystemTime(new Date('2026-10-04T03:47:30.000Z'));
    expect(await service.syncRecentOrders('account-a', 'tenant-a')).toMatchObject({ status: 'PARTIAL', nextOffset: 50 });
    expect(db.rows.marketplaceSyncState[0]).toMatchObject({
      paginationRestartCount: 0,
      windowFrom: new Date('2026-10-03T20:00:00.000Z'),
      windowTo: new Date('2026-10-04T03:00:00.000Z'),
      lastSyncedWindowTo: new Date('2026-10-03T22:00:00.000Z'),
    });
    expect(db.rows.order).toHaveLength(123);
  });

  it('fails the fourth total change permanently and keeps the exhausted budget across service instances', async () => {
    const { db, mlApi, queue, service } = setup(120);
    let total = 120;
    mlApi.listSellerOrdersPageInWindow.mockImplementation(async (_accountId, _tenantId, options) => makePage(options.offset ?? 0, total));
    await service.syncRecentOrders('account-a', 'tenant-a');
    for (let restart = 0; restart < 3; restart += 1) {
      total += 1;
      await service.syncRecentOrders('account-a', 'tenant-a');
      await service.syncRecentOrders('account-a', 'tenant-a');
    }
    total += 1;
    const committedOrders = structuredClone(db.rows.order);
    const queuedBeforeFailure = queue.add.mock.calls.length;
    const terminal = service.syncRecentOrders('account-a', 'tenant-a');
    await expect(terminal).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(terminal).rejects.toThrow(restartLimitMessage);
    expect(db.rows.marketplaceSyncState[0]).toMatchObject({ status: 'FAILED', paginationRestartCount: 3, nextOffset: 50, expectedTotal: 123, lastError: 'PAGINATION_TOTAL_CHANGED' });
    expect(db.rows.marketplaceAccount[0]).toMatchObject({ lastSyncState: 'FAILED', lastSyncError: 'PAGINATION_TOTAL_CHANGED', lastSyncedAt: null });
    expect(db.rows.order).toEqual(committedOrders);
    expect(queue.add).toHaveBeenCalledTimes(queuedBeforeFailure);

    const callsBeforeRetry = mlApi.listSellerOrdersPageInWindow.mock.calls.length;
    const restoredService = new MlOrdersSyncService(db as any, mlApi as any, queue as any);
    for (const retryService of [service, restoredService]) {
      const retry = retryService.syncRecentOrders('account-a', 'tenant-a');
      await expect(retry).rejects.toBeInstanceOf(UnrecoverableError);
      await expect(retry).rejects.toThrow(restartLimitMessage);
    }
    expect(mlApi.listSellerOrdersPageInWindow).toHaveBeenCalledTimes(callsBeforeRetry);
    expect(queue.add).toHaveBeenCalledTimes(queuedBeforeFailure);
    expect(db.rows.marketplaceSyncState[0]).toMatchObject({ status: 'FAILED', paginationRestartCount: 3, lastError: 'PAGINATION_TOTAL_CHANGED' });
  });

  it('keeps a committed restart resumable when scheduling its continuation fails', async () => {
    const { db, mlApi, queue, service } = setup(120);
    await service.syncRecentOrders('account-a', 'tenant-a');
    mlApi.listSellerOrdersPageInWindow.mockImplementation(async (_accountId, _tenantId, options) => makePage(options.offset ?? 0, 80));
    queue.add.mockRejectedValueOnce(new Error('Continuation queue unavailable'));

    await expect(service.syncRecentOrders('account-a', 'tenant-a')).rejects.toThrow('Continuation queue unavailable');
    expect(db.rows.marketplaceSyncState[0]).toMatchObject({ status: 'PARTIAL', nextOffset: 0, expectedTotal: 80, paginationRestartCount: 1, importedCount: 50, completedPages: 0, lastError: 'PAGINATION_TOTAL_CHANGED' });
    expect(db.rows.marketplaceAccount[0]).toMatchObject({ lastSyncState: 'PARTIAL', lastSyncedAt: null });
    expect(db.rows.order).toHaveLength(50);

    const restoredService = new MlOrdersSyncService(db as any, mlApi as any, queue as any);
    expect(await restoredService.syncRecentOrders('account-a', 'tenant-a')).toMatchObject({ status: 'PARTIAL', nextOffset: 50, expectedTotal: 80, importedCount: 50 });
    expect(db.rows.marketplaceSyncState[0]).toMatchObject({ paginationRestartCount: 1, lastError: null });
    expect(mlApi.listSellerOrdersPageInWindow.mock.calls.map((call) => call[2].offset)).toEqual([0, 50, 0]);
  });

  it.each(['restart', 'terminal', 'terminal-after-failure', 'terminal-before-late-error'] as const)('discards an in-flight old page after another worker commits a %s', async (outcome) => {
    const { db, mlApi, queue, service } = setup(120);
    await service.syncRecentOrders('account-a', 'tenant-a');
    const terminal = outcome !== 'restart';
    if (terminal) db.rows.marketplaceSyncState[0].paginationRestartCount = 3;
    if (outcome === 'terminal-after-failure' || outcome === 'terminal-before-late-error') {
      Object.assign(db.rows.marketplaceSyncState[0], { status: 'FAILED', lastError: 'RATE_LIMITED' });
    }
    const requestStarted = deferred<void>();
    const response = deferred<ReturnType<typeof makePage>>();
    mlApi.listSellerOrdersPageInWindow.mockImplementationOnce(async () => {
      requestStarted.resolve();
      return response.promise;
    });
    const oldAttempt = service.syncRecentOrders('account-a', 'tenant-a');
    void oldAttempt.catch(() => undefined);
    await requestStarted.promise;
    mlApi.listSellerOrdersPageInWindow.mockResolvedValueOnce(makePage(50, 121));
    let savedRows: typeof db.rows;
    let queued: number;
    try {
      const concurrent = service.syncRecentOrders('account-a', 'tenant-a');
      if (terminal) await expect(concurrent).rejects.toBeInstanceOf(UnrecoverableError);
      else await expect(concurrent).resolves.toMatchObject({ status: 'PARTIAL', nextOffset: 0 });
      savedRows = structuredClone(db.rows);
      queued = queue.add.mock.calls.length;
    } finally {
      if (outcome === 'terminal-before-late-error') response.reject(new Error('Mercado Livre API error 429'));
      else response.resolve(makePage(50, 120));
    }
    const result = await oldAttempt;
    expect(result).toEqual({
      accountId: 'account-a', importedCount: 50,
      expectedTotal: terminal ? 120 : 121,
      nextOffset: terminal ? 50 : 0,
      status: terminal ? 'FAILED' : 'PARTIAL',
    });
    expect(db.rows).toEqual(savedRows!);
    expect(queue.add).toHaveBeenCalledTimes(queued!);
  });

  it.each([
    ['window', { windowTo: new Date('2026-10-04T23:00:00.000Z') }],
    ['offset', { nextOffset: 100 }],
    ['total', { expectedTotal: 121 }],
    ['restart count', { paginationRestartCount: 1 }],
    ['status', { status: 'FAILED', lastError: 'RATE_LIMITED' }],
    ['completed pages', { completedPages: 2 }],
  ] as const)('returns the current checkpoint without writes when the %s changes during a fetch', async (_field, changedCheckpoint) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-03T22:47:30.000Z'));
    const { db, mlApi, queue, service } = setup(120);
    await service.syncRecentOrders('account-a', 'tenant-a');
    const requestStarted = deferred<void>();
    const response = deferred<ReturnType<typeof makePage>>();
    mlApi.listSellerOrdersPageInWindow.mockImplementationOnce(async () => {
      requestStarted.resolve();
      return response.promise;
    });
    const pending = service.syncRecentOrders('account-a', 'tenant-a');
    await requestStarted.promise;
    Object.assign(db.rows.marketplaceSyncState[0], changedCheckpoint);
    const current = structuredClone(db.rows.marketplaceSyncState[0]);
    const savedRows = structuredClone(db.rows);
    const queued = queue.add.mock.calls.length;
    const upserts = db.order.upsert.mock.calls.length;
    const accountUpdates = db.marketplaceAccount.updateMany.mock.calls.length;
    response.resolve(makePage(50, 120));

    expect(await pending).toEqual({ accountId: 'account-a', importedCount: current.importedCount, expectedTotal: current.expectedTotal, nextOffset: current.nextOffset, status: current.status });
    expect(db.rows).toEqual(savedRows);
    expect(queue.add).toHaveBeenCalledTimes(queued);
    expect(db.order.upsert).toHaveBeenCalledTimes(upserts);
    expect(db.marketplaceAccount.updateMany).toHaveBeenCalledTimes(accountUpdates);
  });

  it('does not restart another tenant account or contact the marketplace for a wrong tenant', async () => {
    const { db, mlApi, queue, service } = setup(120);
    await service.syncRecentOrders('account-a', 'tenant-a');
    const savedRows = structuredClone(db.rows);
    const calls = mlApi.listSellerOrdersPageInWindow.mock.calls.length;
    const queued = queue.add.mock.calls.length;

    await expect(service.syncRecentOrders('account-a', 'tenant-b')).rejects.toThrow();
    expect(db.rows).toEqual(savedRows);
    expect(mlApi.listSellerOrdersPageInWindow).toHaveBeenCalledTimes(calls);
    expect(queue.add).toHaveBeenCalledTimes(queued);
  });

  it.each(['completed', 'legacy'] as const)('cannot overwrite a newer recovery while opening a %s window', async kind => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-03T22:47:30Z'));
    const { db, mlApi, queue, service } = setup(1);
    await service.syncRecentOrders('account-a', 'tenant-a');
    if (kind === 'legacy') Object.assign(db.rows.marketplaceSyncState[0], {
      status: 'PARTIAL', nextOffset: 0, expectedTotal: null, completedPages: 0, windowFrom: null, windowTo: null,
    });
    let total = 120;
    mlApi.listSellerOrdersPageInWindow.mockImplementation(async (_id, _tenant, options) => makePage(options.offset ?? 0, total));
    const updateStarted = deferred<void>();
    const releaseUpdate = deferred<void>();
    const update = db.marketplaceSyncState.updateMany.getMockImplementation()!;
    db.marketplaceSyncState.updateMany.mockImplementationOnce(async (args: any) => {
      updateStarted.resolve();
      await releaseUpdate.promise;
      return update(args);
    });
    const stale = service.syncRecentOrders('account-a', 'tenant-a');
    await updateStarted.promise;
    jest.setSystemTime(new Date('2026-10-04T03:47:30Z'));
    let savedRows: typeof db.rows;
    let calls: number;
    let queued: number;
    try {
      await service.syncRecentOrders('account-a', 'tenant-a');
      total = 121;
      await service.syncRecentOrders('account-a', 'tenant-a');
      savedRows = structuredClone(db.rows);
      calls = mlApi.listSellerOrdersPageInWindow.mock.calls.length;
      queued = queue.add.mock.calls.length;
    } finally {
      releaseUpdate.resolve();
    }
    expect(await stale).toMatchObject({ status: 'PARTIAL', nextOffset: 0, expectedTotal: 121 });
    expect(db.rows).toEqual(savedRows!);
    expect(db.rows.marketplaceSyncState[0]).toMatchObject({ paginationRestartCount: 1 });
    expect(mlApi.listSellerOrdersPageInWindow).toHaveBeenCalledTimes(calls!);
    expect(queue.add).toHaveBeenCalledTimes(queued!);
  });

  it('uses a fixed UTC-hour window and persists its completed boundary', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-03T22:47:30.000Z'));
    const { db, mlApi, service } = setup(1);

    const result = await service.syncRecentOrders('account-a', 'tenant-a');
    const options = mlApi.listSellerOrdersPageInWindow.mock.calls[0][2];
    expect(result.status).toBe('COMPLETE');
    expect(options.windowTo).toEqual(new Date('2026-10-03T22:00:00.000Z'));
    expect(options.windowFrom).toEqual(new Date('2026-07-05T22:00:00.000Z'));
    expect(options.windowFrom).toEqual(new Date(options.windowTo.getTime() - INITIAL_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000));
    expect(db.rows.marketplaceSyncState[0]).toMatchObject({
      status: 'COMPLETE',
      lastSyncedWindowTo: new Date('2026-10-03T22:00:00.000Z'),
    });
  });

  it('reconciles an overlapping order through one idempotent upsert', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-03T22:47:30.000Z'));
    const { db, mlApi, service } = setup(1);
    const firstOrder = { id: 999, status: 'paid', currency_id: 'BRL', total_amount: 10, date_created: '2026-10-03T20:30:00.000Z' };
    const correctedOrder = { ...firstOrder, total_amount: 12.5, date_created: '2026-10-03T20:45:00.000Z' };
    mlApi.listSellerOrdersPageInWindow
      .mockResolvedValueOnce({ results: [firstOrder], offset: 0, limit: 50, total: 1, nextOffset: 1, complete: true })
      .mockResolvedValueOnce({ results: [correctedOrder], offset: 0, limit: 50, total: 1, nextOffset: 1, complete: true });

    await service.syncRecentOrders('account-a', 'tenant-a');
    jest.setSystemTime(new Date('2026-10-04T03:47:30.000Z'));
    await service.syncRecentOrders('account-a', 'tenant-a');

    expect(db.rows.order).toHaveLength(1);
    expect(db.rows.order[0]).toMatchObject({ externalOrderId: '999', totalAmount: 12.5 });
    expect(db.rows.order[0].createdAt).toEqual(new Date('2026-10-03T20:45:00.000Z'));
    const secondOptions = mlApi.listSellerOrdersPageInWindow.mock.calls[1][2];
    expect(secondOptions.windowFrom).toEqual(new Date('2026-10-03T20:00:00.000Z'));
    expect(secondOptions.windowTo).toEqual(new Date('2026-10-04T03:00:00.000Z'));
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
      listSellerOrdersPageInWindow: jest.fn(async (accountId: string, _tenantId: string, options: { offset?: number }) =>
        makePage(options.offset ?? 0, (db as any)[`total_${accountId}`])),
    };
    const service = new MlOrdersSyncService(db as any, mlApi as any, { add: jest.fn() } as any);

    await service.syncRecentOrders('account-a', 'tenant-a');
    await service.syncRecentOrders('account-b', 'tenant-a');

    expect(db.rows.marketplaceSyncState).toEqual(expect.arrayContaining([
      expect.objectContaining({ marketplaceAccountId: 'account-a', nextOffset: 50, expectedTotal: 60, importedCount: 50 }),
      expect.objectContaining({ marketplaceAccountId: 'account-b', nextOffset: 50, expectedTotal: 110, importedCount: 50 }),
    ]));
    expect(mlApi.listSellerOrdersPageInWindow.mock.calls.map((call) => [call[0], call[2].offset])).toEqual([
      ['account-a', 0],
      ['account-b', 0],
    ]);
  });
});
