import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { inTenant, tenantContext } from './tenant-context';

// No SQL is executed in this suite. It verifies the application contract with
// a fake Prisma driver; PostgreSQL RLS enforcement still needs a real DB test.
jest.mock('./prisma-options', () => ({ createPrismaAdapter: jest.fn(() => ({})) }));
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  PrismaClient: class {
    order = { findMany: jest.fn() };
    marketplaceSyncState = { findMany: jest.fn() };
    testDriver = {
      begin: jest.fn(),
      raw: jest.fn().mockResolvedValue([]),
      connect: jest.fn(),
      disconnect: jest.fn(),
      transactions: [] as any[],
      configure: (_tx: any) => {},
    };

    constructor() {
      this.testDriver.begin.mockImplementation(async (operation: any) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([]),
          order: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
          marketplaceSyncState: {
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn(),
            updateMany: jest.fn(),
          },
        };
        this.testDriver.transactions.push(tx);
        this.testDriver.configure(tx);
        return operation(tx);
      });
    }

    $transaction(operation: any, options: any) {
      return this.testDriver.begin(operation, options);
    }
    $queryRaw(...args: any[]) { return this.testDriver.raw(...args); }
    $connect() { return this.testDriver.connect(); }
    $disconnect() { return this.testDriver.disconnect(); }
  },
}));

describe('Prisma tenant context (mock driver, not PostgreSQL)', () => {
  let prisma: PrismaService;
  let driver: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    prisma = new PrismaService();
    driver = (prisma as any).testDriver;
  });
  afterEach(() => {
    expect(tenantContext.getStore()).toBeUndefined();
    jest.restoreAllMocks();
  });

  it.each(['order', 'marketplaceSyncState'] as const)(
    'requires context for %s and sets it on the same transaction before querying',
    async (model) => {
      const args = { where: { tenantId: 'tenant-a' } };
      expect(() => (prisma[model] as any).findMany(args)).toThrow('Tenant context required');
      expect(driver.begin).not.toHaveBeenCalled();

      await inTenant('tenant-a', () => (prisma[model] as any).findMany(args));

      expect(driver.begin).toHaveBeenCalledTimes(1);
      expect(driver.begin).toHaveBeenCalledWith(expect.any(Function), { maxWait: 10000, timeout: 15000 });
      const tx = driver.transactions[0];
      const [sql, tenantId] = tx.$queryRaw.mock.calls[0];
      expect(sql.join('$1')).toBe("SELECT set_config('app.tenant_id', $1, true)");
      expect(tenantId).toBe('tenant-a');
      expect(tx[model].findMany).toHaveBeenCalledWith(args);
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx[model].findMany.mock.invocationCallOrder[0]);
    },
  );

  it('keeps tenant values parameterized instead of interpolating them into SQL', async () => {
    const tenantId = "tenant-a'; SELECT 'synthetic-test";
    await inTenant(tenantId, () => prisma.marketplaceSyncState.findMany());
    const [sql, value] = driver.transactions[0].$queryRaw.mock.calls[0];
    expect(sql.join('')).not.toContain(tenantId);
    expect(value).toBe(tenantId);
  });

  it('keeps page writes and sync checkpoints in one scoped interactive transaction', async () => {
    await inTenant('tenant-a', () => prisma.$transaction(async (tx) => {
      expect(tenantContext.getStore()?.transaction).toBe(tx);
      await tx.order.upsert({} as never);
      await tx.marketplaceSyncState.updateMany({
        where: { tenantId: 'tenant-a' },
        data: { status: 'PARTIAL' },
      });
      // A nested delegate also reuses this transaction; no second connection.
      await prisma.marketplaceSyncState.findMany({ where: { tenantId: 'tenant-a' } });
    }));
    expect(driver.begin).toHaveBeenCalledTimes(1);
    const tx = driver.transactions[0];
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.order.upsert).toHaveBeenCalledTimes(1);
    expect(tx.marketplaceSyncState.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.marketplaceSyncState.findMany).toHaveBeenCalledTimes(1);
  });

  it('refuses cross-tenant nesting and transactions without authenticated context', async () => {
    expect(() => prisma.$transaction(async () => undefined)).toThrow('Tenant context');
    await inTenant('tenant-a', async () => {
      await expect(prisma.withTenant('tenant-b', async () => undefined)).rejects.toThrow('Cross-tenant');
      expect(() => inTenant('tenant-b', () => undefined)).toThrow('Tenant context cannot change');
      expect(() => prisma.$transaction([])).toThrow('interactive transaction required');
    });
    expect(driver.begin).not.toHaveBeenCalled();
  });

  it('keeps concurrent tenants separate in application context', async () => {
    const seen: string[] = [];
    await Promise.all(['tenant-a', 'tenant-b'].map((tenantId) =>
      inTenant(tenantId, () => prisma.$transaction(async (tx) => {
        await Promise.resolve();
        seen.push(tenantContext.getStore()!.tenantId);
        await tx.marketplaceSyncState.findMany({ where: { tenantId } });
      })),
    ));
    expect(seen.sort()).toEqual(['tenant-a', 'tenant-b']);
    expect(driver.transactions).toHaveLength(2);
    for (const tx of driver.transactions) {
      const tenantId = tx.$queryRaw.mock.calls[0][1];
      expect(tx.marketplaceSyncState.findMany).toHaveBeenCalledWith({ where: { tenantId } });
    }
  });

  it('propagates page failures and releases the application context for subsequent calls', async () => {
    await expect(inTenant('tenant-a', () => prisma.$transaction(async () => {
      throw new Error('synthetic page failure');
    }))).rejects.toThrow('synthetic page failure');
    expect(tenantContext.getStore()).toBeUndefined();
    await inTenant('tenant-b', () => prisma.marketplaceSyncState.findMany());
    expect(driver.transactions[1].$queryRaw.mock.calls[0][1]).toBe('tenant-b');
  });

  it('does not query a domain model when configuring the transaction fails', async () => {
    driver.configure = (tx: any) => tx.$queryRaw.mockRejectedValue(new Error('set_config failed'));
    await expect(inTenant('tenant-a', () => prisma.marketplaceSyncState.findMany())).rejects.toThrow('set_config failed');
    expect(driver.transactions[0].marketplaceSyncState.findMany).not.toHaveBeenCalled();
  });

  it('uses only the historical parameterized lookup before login', async () => {
    const login = { id: 'user-a', email: 'admin@example.test', tenantId: 'tenant-a', role: 'ADMIN' };
    driver.raw.mockResolvedValue([login]);
    await expect(prisma.findUserForLogin(login.email)).resolves.toEqual(login);
    const [sql, email] = driver.raw.mock.calls[0];
    expect(sql.join('$1')).toBe('SELECT * FROM public.farmaecon_login_lookup($1)');
    expect(email).toBe(login.email);
    expect(driver.begin).not.toHaveBeenCalled();
    driver.raw.mockResolvedValue([]);
    await expect(prisma.findUserForLogin('missing@example.test')).resolves.toBeNull();
  });

  it('refuses startup for an owner/superuser/BYPASSRLS connection', async () => {
    driver.raw.mockResolvedValue([{ allowed: false }]);
    await expect(prisma.onModuleInit()).rejects.toThrow('non-owner, non-BYPASSRLS');
  });

  it('requires RLS enabled on all nine tables, including sync states', async () => {
    driver.raw.mockResolvedValueOnce([{ allowed: true }]).mockResolvedValueOnce([{ count: 8 }]);
    await expect(prisma.onModuleInit()).rejects.toThrow('Required tenant RLS policies are missing');
    expect(driver.raw.mock.calls[1][0].join('')).toContain("'marketplace_sync_states'");
    driver.raw.mockResolvedValueOnce([{ allowed: true }]).mockResolvedValueOnce([{ count: 9 }]);
    await expect(prisma.onModuleInit()).resolves.toBeUndefined();
  });
});

describe('sync state RLS migration (static checks only, SQL not executed)', () => {
  it('uses the historical setting and account ownership check, with only required grants', () => {
    const sql = readFileSync(join(__dirname, '../../../prisma/migrations/20261004_marketplace_sync_state_rls/migration.sql'), 'utf8');
    expect(sql).toContain('ALTER TABLE public.marketplace_sync_states ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('CREATE POLICY tenant_isolation ON public.marketplace_sync_states');
    expect(sql).toContain('DROP POLICY IF EXISTS tenant_isolation ON public.marketplace_sync_states;\nCREATE POLICY tenant_isolation ON public.marketplace_sync_states');
    expect(sql.match(/tenant_id = nullif\(current_setting\('app\.tenant_id', true\), ''\)/g)).toHaveLength(2);
    expect(sql).toContain('a.tenant_id = marketplace_sync_states.tenant_id');
    expect(sql).toContain('a.id = marketplace_sync_states.marketplace_account_id');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.marketplace_sync_states\n  TO farmaecon_runtime;');
    expect(sql.match(/GRANT\s+[\s\S]*?;/g)).toHaveLength(1);
    expect(sql).not.toMatch(/GRANT\s+(?:ALL|[^;]*DELETE|[^;]*TRUNCATE)/i);
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
  });
});
