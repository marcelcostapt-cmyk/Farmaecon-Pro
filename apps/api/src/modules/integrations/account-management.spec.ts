import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MemoryPrisma } from '../../../test/memory-prisma';
import { IntegrationsService } from './integrations.service';

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
  const ordersSync = { syncRecentOrders: jest.fn() };
  const scheduler = { removeRecurring: jest.fn(), ensureRecurring: jest.fn(), nextRunAt: jest.fn().mockResolvedValue(null) };
  const service = new IntegrationsService(db as never, syncQueue as never, ordersSync as never, scheduler as never);
  return { db, service, syncQueue, scheduler };
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
