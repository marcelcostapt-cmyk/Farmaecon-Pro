import type { ExecutionContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { defer, firstValueFrom } from 'rxjs';
import { MarketplaceSyncProcessor } from '../../modules/integrations/marketplace-sync.processor';
import { TokenRefreshProcessor } from '../../modules/integrations/token-refresh.processor';
import { inTenant, tenantContext } from './tenant-context';
import { TenantInterceptor } from './tenant.interceptor';

describe('tenant context entry points (no database or queue connection)', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));
  afterEach(() => {
    expect(tenantContext.getStore()).toBeUndefined();
    jest.restoreAllMocks();
  });

  it('uses the authenticated principal, never a tenant from headers/body/query', async () => {
    const request = {
      user: { tenantId: 'tenant-a' },
      body: { tenantId: 'tenant-b' },
      query: { tenantId: 'tenant-b' },
      headers: { 'x-tenant-id': 'tenant-b' },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
    const next = { handle: () => defer(async () => {
      await Promise.resolve();
      return tenantContext.getStore()?.tenantId;
    }) };
    await expect(firstValueFrom(new TenantInterceptor().intercept(context, next))).resolves.toBe('tenant-a');
  });

  it('does not create tenant context for unauthenticated requests', async () => {
    const context = { switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-tenant-id': 'tenant-b' } }) }) } as ExecutionContext;
    const next = { handle: () => defer(async () => tenantContext.getStore()) };
    await expect(firstValueFrom(new TenantInterceptor().intercept(context, next))).resolves.toBeUndefined();
  });

  it.each(['initial-sync', 'sync-account-orders'])(
    'establishes tenant context for the %s worker without opening a whole-job transaction',
    async (name) => {
      const syncRecentOrders = jest.fn(async (accountId: string, tenantId: string) => {
        await Promise.resolve();
        expect(accountId).toBe('account-a');
        expect(tenantId).toBe('tenant-a');
        expect(tenantContext.getStore()).toEqual({ tenantId: 'tenant-a' });
      });
      const worker = new MarketplaceSyncProcessor({ syncRecentOrders } as never);
      await worker.process({ name, data: { accountId: 'account-a', tenantId: 'tenant-a' } } as Job);
      expect(syncRecentOrders).toHaveBeenCalledTimes(1);
    },
  );

  it('establishes the same context for the token refresh worker', async () => {
    const refreshToken = jest.fn(async () => {
      await Promise.resolve();
      expect(tenantContext.getStore()).toEqual({ tenantId: 'tenant-a' });
    });
    const worker = new TokenRefreshProcessor({ refreshToken } as never);
    await worker.process({ data: { accountId: 'account-a', tenantId: 'tenant-a' } } as Job);
    expect(refreshToken).toHaveBeenCalledWith('account-a', 'tenant-a');
  });

  it('rejects jobs missing a tenant before either worker accesses data', async () => {
    const syncRecentOrders = jest.fn();
    const refreshToken = jest.fn();
    const job = { name: 'sync-account-orders', data: { accountId: 'account-a' } } as Job;
    await expect(new MarketplaceSyncProcessor({ syncRecentOrders } as never).process(job)).rejects.toThrow('Authenticated tenant context required');
    await expect(new TokenRefreshProcessor({ refreshToken } as never).process(job)).rejects.toThrow('Authenticated tenant context required');
    expect(syncRecentOrders).not.toHaveBeenCalled();
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it('does not let a worker switch an existing tenant context', async () => {
    const syncRecentOrders = jest.fn();
    const worker = new MarketplaceSyncProcessor({ syncRecentOrders } as never);
    await expect(inTenant('tenant-a', () => worker.process({
      name: 'sync-account-orders', data: { accountId: 'account-b', tenantId: 'tenant-b' },
    } as Job))).rejects.toThrow('Tenant context cannot change');
    expect(syncRecentOrders).not.toHaveBeenCalled();
  });
});
