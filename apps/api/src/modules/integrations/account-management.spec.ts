import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MemoryPrisma } from '../../../test/memory-prisma';
import { IntegrationsService } from './integrations.service';
import { AccountErrors } from './account-errors';

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-a', tenantId: 'a', platform: 'MERCADO_LIVRE', status: 'ACTIVE', name: 'ML #1', displayName: null,
    externalSellerId: '1', accessToken: 'enc-access', refreshToken: 'enc-refresh', expiresAt: new Date(), createdAt: new Date(),
    ...overrides,
  };
}

function setup(rows: Record<string, unknown>[] = [account()]) {
  const db = new MemoryPrisma();
  db.rows.marketplaceAccount.push(...rows);
  const syncQueue = { add: jest.fn(), getJobs: jest.fn().mockResolvedValue([]) };
  const tokenQueue = { getJobs: jest.fn().mockResolvedValue([]) };
  const ordersSync = { syncRecentOrders: jest.fn() };
  const scheduler = { removeRecurring: jest.fn(), ensureRecurring: jest.fn(), nextRunAt: jest.fn().mockResolvedValue(null) };
  const service = new IntegrationsService(db as never, syncQueue as never, tokenQueue as never, ordersSync as never, {} as never, scheduler as never);
  return { db, service, syncQueue, tokenQueue, scheduler };
}

describe('IntegrationsService.rename', () => {
  it('trims and stores the display name', async () => {
    const { db, service } = setup();
    const result = await service.rename('a', 'acc-a', '  Farmashop ');
    expect(db.rows.marketplaceAccount[0].displayName).toBe('Farmashop');
    expect(result).toMatchObject({ id: 'acc-a', displayName: 'Farmashop' });
    expect(JSON.stringify(result)).not.toMatch(/enc-access|enc-refresh/);
  });

  it('stores null for blank names', async () => {
    const { db, service } = setup([account({ displayName: 'Old' })]);
    await service.rename('a', 'acc-a', '   ');
    expect(db.rows.marketplaceAccount[0].displayName).toBeNull();
    db.rows.marketplaceAccount[0].displayName = 'Old';
    await service.rename('a', 'acc-a', null);
    expect(db.rows.marketplaceAccount[0].displayName).toBeNull();
  });

  it('rejects names longer than 60 characters', async () => {
    const { db, service } = setup();
    await expect(service.rename('a', 'acc-a', 'x'.repeat(61))).rejects.toBeInstanceOf(BadRequestException);
    expect(db.rows.marketplaceAccount[0].displayName).toBeNull();
    await service.rename('a', 'acc-a', '😀'.repeat(60));
    expect(db.rows.marketplaceAccount[0].displayName).toBe('😀'.repeat(60));
  });

  it('returns 404 for an account of another tenant', async () => {
    const { db, service } = setup();
    await expect(service.rename('b', 'acc-a', 'X')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.rows.marketplaceAccount[0].displayName).toBeNull();
  });
});

const job = (accountId: string) => ({ id: `job-${accountId}`, data: { tenantId: 'a', accountId }, remove: jest.fn().mockResolvedValue(undefined) });

describe('IntegrationsService.disconnect', () => {
  it('clears tokens, marks DISCONNECTED and removes schedule and token refresh jobs', async () => {
    const { db, service, scheduler, tokenQueue } = setup([account(), account({ id: 'acc-b', externalSellerId: '2' })]);
    const own = job('acc-a'), other = job('acc-b');
    tokenQueue.getJobs.mockResolvedValue([own, other]);
    await service.disconnect('a', 'acc-a');
    expect(db.rows.marketplaceAccount[0]).toMatchObject({ status: 'DISCONNECTED', accessToken: null, refreshToken: null, expiresAt: null });
    expect(db.rows.marketplaceAccount[1].status).toBe('ACTIVE');
    expect(scheduler.removeRecurring).toHaveBeenCalledWith('acc-a');
    expect(own.remove).toHaveBeenCalled();
    expect(other.remove).not.toHaveBeenCalled();
  });

  it('is a no-op the second time', async () => {
    const { db, service } = setup();
    await service.disconnect('a', 'acc-a');
    await expect(service.disconnect('a', 'acc-a')).resolves.toBeUndefined();
    expect(db.rows.marketplaceAccount[0].status).toBe('DISCONNECTED');
  });

  it('returns 404 for another tenant', async () => {
    const { db, service, scheduler } = setup();
    await expect(service.disconnect('b', 'acc-a')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.rows.marketplaceAccount[0].status).toBe('ACTIVE');
    expect(scheduler.removeRecurring).not.toHaveBeenCalled();
  });
});

describe('IntegrationsService.remove', () => {
  const conflictCode = (error: unknown) => (error as ConflictException).getResponse() as { code: string; message: string };

  it('deletes a disconnected account without orders or pending jobs', async () => {
    const { db, service, scheduler } = setup([account({ status: 'DISCONNECTED', accessToken: null, refreshToken: null })]);
    await service.remove('a', 'acc-a');
    expect(db.rows.marketplaceAccount).toHaveLength(0);
    expect(scheduler.removeRecurring).toHaveBeenCalledWith('acc-a');
  });

  it('refuses ACTIVE accounts', async () => {
    const { db, service } = setup();
    const error = await service.remove('a', 'acc-a').catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(conflictCode(error).code).toBe('ACCOUNT_NOT_DISCONNECTED');
    expect(db.rows.marketplaceAccount).toHaveLength(1);
  });

  it('refuses accounts with orders', async () => {
    const { db, service } = setup([account({ status: 'DISCONNECTED' })]);
    db.rows.order.push({ id: 'order-1', tenantId: 'a', marketplaceAccountId: 'acc-a' });
    const error = await service.remove('a', 'acc-a').catch((e) => e);
    expect(conflictCode(error)).toEqual({ code: 'ACCOUNT_HAS_ORDERS', message: AccountErrors.ACCOUNT_HAS_ORDERS });
    expect(db.rows.marketplaceAccount).toHaveLength(1);
    expect(db.rows.order).toHaveLength(1);
  });

  it.each(['sync', 'token'])('refuses accounts with pending jobs in the %s queue', async (which) => {
    const { db, service, syncQueue, tokenQueue } = setup([account({ status: 'DISCONNECTED' })]);
    (which === 'sync' ? syncQueue : tokenQueue).getJobs.mockResolvedValue([job('acc-a')]);
    const error = await service.remove('a', 'acc-a').catch((e) => e);
    expect(conflictCode(error).code).toBe('ACCOUNT_HAS_PENDING_JOBS');
    expect(db.rows.marketplaceAccount).toHaveLength(1);
  });

  it('returns 404 for another tenant even if it would conflict', async () => {
    const { db, service } = setup();
    await expect(service.remove('b', 'acc-a')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.rows.marketplaceAccount).toHaveLength(1);
  });
});
