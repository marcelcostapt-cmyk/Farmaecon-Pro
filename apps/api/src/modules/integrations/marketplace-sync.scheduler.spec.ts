import { Job } from 'bullmq';
import { tenantContext } from '../../shared/prisma/tenant-context';
import { IntegrationsService } from './integrations.service';
import { MarketplaceSyncProcessor } from './marketplace-sync.processor';
import {
  MarketplaceSyncScheduler,
  RECURRING_SYNC_INTERVAL_MS,
  SCHEDULED_SYNC_JOB,
} from './marketplace-sync.scheduler';

const ACTIVE_ML = { status: 'ACTIVE', platform: 'MERCADO_LIVRE' };

function setup(account: Record<string, unknown> | null = ACTIVE_ML, inFlight: Partial<Job>[] = []) {
  const queue = {
    upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
    removeJobScheduler: jest.fn().mockResolvedValue(true),
    getJobs: jest.fn().mockResolvedValue(inFlight),
  };
  const prisma = { marketplaceAccount: { findFirst: jest.fn().mockResolvedValue(account) } };
  const ordersSync = { syncRecentOrders: jest.fn().mockResolvedValue({ status: 'COMPLETE' }) };
  const scheduler = new MarketplaceSyncScheduler(queue as never, prisma as never, ordersSync as never);
  return { queue, prisma, ordersSync, scheduler };
}

const tick = (accountId = 'account-a', id = 'repeat:tick-1') =>
  ({ id, name: SCHEDULED_SYNC_JOB, data: { tenantId: 'tenant-a', accountId } }) as Job;

describe('MarketplaceSyncScheduler', () => {
  it('keeps the recurring interval at 15 minutes and never below 10', () => {
    expect(RECURRING_SYNC_INTERVAL_MS).toBe(15 * 60 * 1000);
    expect(RECURRING_SYNC_INTERVAL_MS).toBeGreaterThanOrEqual(10 * 60 * 1000);
  });

  it('upserts one schedule per account with a predictable id and the existing payload shape', async () => {
    const { queue, scheduler } = setup();
    await scheduler.ensureRecurring('tenant-a', 'account-a');
    await scheduler.ensureRecurring('tenant-a', 'account-a');

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    for (const [id, repeat, template] of queue.upsertJobScheduler.mock.calls) {
      expect(id).toBe('orders-sync-account-a');
      expect(id).not.toContain(':');
      expect(repeat).toEqual({ every: RECURRING_SYNC_INTERVAL_MS });
      expect(template).toMatchObject({
        name: SCHEDULED_SYNC_JOB,
        data: { tenantId: 'tenant-a', accountId: 'account-a' },
        opts: { attempts: 1 },
      });
    }
  });

  it('refuses to schedule without tenant and account', async () => {
    const { queue, scheduler } = setup();
    await expect(scheduler.ensureRecurring('', 'account-a')).rejects.toThrow('Account and tenant are required');
    await expect(scheduler.ensureRecurring('tenant-a', '')).rejects.toThrow('Account and tenant are required');
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('syncs an active Mercado Livre account through the existing sync service', async () => {
    const { ordersSync, prisma, queue, scheduler } = setup();
    await expect(scheduler.runScheduledTick(tick())).resolves.toBe('SYNCED');
    expect(prisma.marketplaceAccount.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'account-a', tenantId: 'tenant-a' },
    }));
    expect(ordersSync.syncRecentOrders).toHaveBeenCalledWith('account-a', 'tenant-a');
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it.each(['sync-account-orders', 'initial-sync'])(
    'skips when a %s page chain is already in flight for the account',
    async (name) => {
      const { ordersSync, scheduler } = setup(ACTIVE_ML, [
        { id: '42', name, data: { tenantId: 'tenant-a', accountId: 'account-a' } },
      ]);
      await expect(scheduler.runScheduledTick(tick())).resolves.toBe('SKIPPED_IN_FLIGHT');
      expect(ordersSync.syncRecentOrders).not.toHaveBeenCalled();
    },
  );

  it('ignores its own job, its next delayed tick and other accounts when checking overlap', async () => {
    const { ordersSync, scheduler } = setup(ACTIVE_ML, [
      { id: 'repeat:tick-1', name: SCHEDULED_SYNC_JOB, data: { tenantId: 'tenant-a', accountId: 'account-a' } },
      { id: 'repeat:tick-2', name: SCHEDULED_SYNC_JOB, data: { tenantId: 'tenant-a', accountId: 'account-a' } },
      { id: '7', name: 'sync-account-orders', data: { tenantId: 'tenant-a', accountId: 'account-b' } },
    ]);
    await expect(scheduler.runScheduledTick(tick())).resolves.toBe('SYNCED');
    expect(ordersSync.syncRecentOrders).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing', null],
    ['disconnected', { status: 'DISCONNECTED', platform: 'MERCADO_LIVRE' }],
    ['inactive', { status: 'INACTIVE', platform: 'MERCADO_LIVRE' }],
    ['not Mercado Livre', { status: 'ACTIVE', platform: 'SHOPEE' }],
  ])('removes its own schedule and does not sync a %s account', async (_label, account) => {
    const { ordersSync, queue, scheduler } = setup(account as never);
    await expect(scheduler.runScheduledTick(tick())).resolves.toBe('UNSCHEDULED');
    expect(queue.removeJobScheduler).toHaveBeenCalledWith('orders-sync-account-a');
    expect(ordersSync.syncRecentOrders).not.toHaveBeenCalled();
  });

  it('propagates sync failures so the tick is recorded as failed', async () => {
    const { ordersSync, scheduler } = setup();
    ordersSync.syncRecentOrders.mockRejectedValue(new Error('Mercado Livre API error 401'));
    await expect(scheduler.runScheduledTick(tick())).rejects.toThrow('Mercado Livre API error 401');
  });
});

describe('MarketplaceSyncProcessor recurring integration', () => {
  const job = (name: string) => ({ id: '1', name, data: { tenantId: 'tenant-a', accountId: 'account-a' } }) as Job;

  it('registers the recurring schedule only after a pass completes', async () => {
    const scheduler = { ensureRecurring: jest.fn(), runScheduledTick: jest.fn() };
    const syncRecentOrders = jest.fn()
      .mockResolvedValueOnce({ status: 'PARTIAL' })
      .mockResolvedValueOnce({ status: 'COMPLETE' });
    const worker = new MarketplaceSyncProcessor({ syncRecentOrders } as never, scheduler as never);

    await worker.process(job('sync-account-orders'));
    expect(scheduler.ensureRecurring).not.toHaveBeenCalled();
    await worker.process(job('initial-sync'));
    expect(scheduler.ensureRecurring).toHaveBeenCalledWith('tenant-a', 'account-a');
  });

  it('does not register a schedule when the pass fails', async () => {
    const scheduler = { ensureRecurring: jest.fn(), runScheduledTick: jest.fn() };
    const syncRecentOrders = jest.fn().mockRejectedValue(new Error('boom'));
    const worker = new MarketplaceSyncProcessor({ syncRecentOrders } as never, scheduler as never);
    await expect(worker.process(job('sync-account-orders'))).rejects.toThrow('boom');
    expect(scheduler.ensureRecurring).not.toHaveBeenCalled();
  });

  it('runs scheduled ticks inside the job tenant context', async () => {
    const scheduler = {
      ensureRecurring: jest.fn(),
      runScheduledTick: jest.fn(async () => {
        expect(tenantContext.getStore()).toEqual({ tenantId: 'tenant-a' });
        return 'SYNCED';
      }),
    };
    const worker = new MarketplaceSyncProcessor({ syncRecentOrders: jest.fn() } as never, scheduler as never);
    await worker.process(job(SCHEDULED_SYNC_JOB));
    expect(scheduler.runScheduledTick).toHaveBeenCalledTimes(1);
  });

  it('rejects scheduled ticks without a tenant before touching data', async () => {
    const scheduler = { ensureRecurring: jest.fn(), runScheduledTick: jest.fn() };
    const worker = new MarketplaceSyncProcessor({ syncRecentOrders: jest.fn() } as never, scheduler as never);
    await expect(worker.process({ id: '1', name: SCHEDULED_SYNC_JOB, data: { accountId: 'account-a' } } as Job))
      .rejects.toThrow('Authenticated tenant context required');
    expect(scheduler.runScheduledTick).not.toHaveBeenCalled();
  });
});

describe('IntegrationsService.disconnect', () => {
  it('removes the recurring schedule of a disconnected account', async () => {
    const prisma = { marketplaceAccount: { findFirstOrThrow: jest.fn().mockResolvedValue({}), updateMany: jest.fn() } };
    const scheduler = { removeRecurring: jest.fn() };
    const service = new IntegrationsService(prisma as never, {} as never, {} as never, scheduler as never);
    await service.disconnect('tenant-a', 'account-a');
    expect(scheduler.removeRecurring).toHaveBeenCalledWith('account-a');
  });
});
