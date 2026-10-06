import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { Global, Module, ValidationPipe, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { AuthModule } from '../src/modules/auth/auth.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { UsersController } from '../src/modules/users/users.controller';
import { UsersService } from '../src/modules/users/users.service';
import { OrdersController } from '../src/modules/orders/orders.controller';
import { OrdersService } from '../src/modules/orders/orders.service';
import { ObservationController } from '../src/modules/observation/observation.controller';
import { ObservationService } from '../src/modules/observation/observation.service';
import { IntegrationsService } from '../src/modules/integrations/integrations.service';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { inTenant } from '../src/shared/prisma/tenant-context';
import { TenantInterceptor } from '../src/shared/prisma/tenant.interceptor';
import { Queue } from 'bullmq';
import { MlOrdersSyncService } from '../src/modules/integrations/ml-orders-sync.service';

const keys = { JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex') };
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
class TestDatabase {}

describe('PostgreSQL HTTP security boundaries', () => {
  let app: INestApplication;
  let db: PrismaService;
  let owner: PrismaClient;
  let auth: AuthService;
  const prefix = `security-${randomUUID()}`;
  const tenantA = `${prefix}-a`, tenantB = `${prefix}-b`;
  const password = randomBytes(24).toString('hex');
  let a: { accessToken: string; refreshToken: string };
  let b: typeof a, operator: typeof a;
  const bearer = (token: string) => `Bearer ${token}`;
  const safe = (body: unknown) => expect(JSON.stringify(body)).not.toMatch(/sentinel|accessToken|refreshToken|password|refreshHash|verifier/);

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
    // Owner is used only to provision/clean fixtures. All assertions use runtime.
    owner = new PrismaClient({ adapter: new PrismaPg(ownerUrl.toString()) });
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => keys] }), TestDatabase, AuthModule],
      controllers: [UsersController, OrdersController, ObservationController],
      providers: [UsersService, OrdersService, ObservationService],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new TenantInterceptor());
    await app.listen(0, '127.0.0.1');
    db = module.get(PrismaService); auth = module.get(AuthService);
    for (const tenantId of [tenantA, tenantB]) {
      await owner.tenant.create({ data: { id: tenantId, name: tenantId } });
      await owner.marketplaceAccount.create({ data: { id: tenantId, tenantId, platform: 'MERCADO_LIVRE', name: tenantId, source: 'SIMULATED', accessToken: 'sentinel-access', refreshToken: 'sentinel-refresh', lastSyncedAt: new Date() } });
      await owner.order.create({ data: { id: tenantId, tenantId, marketplaceAccountId: tenantId, externalOrderId: tenantId, totalAmount: 125.5, status: 'PAID' } });
      await owner.user.create({ data: { id: tenantId, tenantId, name: 'Admin', email: `${tenantId}@test.local`, password: await bcrypt.hash(password, 4), role: 'ADMIN' } });
      await owner.marketplaceSyncState.create({ data: { id: tenantId, tenantId, marketplaceAccountId: tenantId } });
    }
    await owner.user.create({ data: { id: `${prefix}-operator`, tenantId: tenantA, name: 'Operator', email: `${prefix}-operator@test.local`, password: await bcrypt.hash(password, 4), role: 'OPERATOR' } });
  }, 30000);

  beforeEach(async () => {
    a = await auth.login({ id: tenantA, tenantId: tenantA });
    b = await auth.login({ id: tenantB, tenantId: tenantB });
    operator = await auth.login({ id: `${prefix}-operator`, tenantId: tenantA });
  });

  afterAll(async () => {
    if (owner) {
      await owner.authSession.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      await owner.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
      await owner.$disconnect();
    }
    await app?.close();
  });

  it('validates login and rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).post('/auth/login').send({ email: `${tenantA}@test.local`, password }).expect(200);
    await request(app.getHttpServer()).post('/auth/login').send({ email: `${tenantA}@test.local`, password: 'incorrect' }).expect(401);
    await request(app.getHttpServer()).get('/orders').expect(401);
  });

  it('isolates both companies and never serializes marketplace credentials', async () => {
    for (const [tenant, session] of [[tenantA, a], [tenantB, b]] as const) {
      const list = await request(app.getHttpServer()).get('/orders').set('Authorization', bearer(session.accessToken)).expect(200);
      expect(list.body.data.map((o: { id: string }) => o.id)).toEqual([tenant]); safe(list.body);
      const detail = await request(app.getHttpServer()).get(`/orders/${tenant}`).set('Authorization', bearer(session.accessToken)).expect(200); safe(detail.body);
      const report = await request(app.getHttpServer()).get('/observation/report').set('Authorization', bearer(session.accessToken)).expect(200);
      expect(report.body.data.sources.map((s: { id: string }) => s.id)).toEqual([tenant]);
      expect(report.body.data.financial.netProfit).toBeNull(); safe(report.body);
      safe(await inTenant(tenant, () => new IntegrationsService(db, {} as never, {} as never).findAll(tenant)));
    }
    await request(app.getHttpServer()).get(`/orders/${tenantB}`).set('Authorization', bearer(a.accessToken)).expect(404);
  });

  it('rejects cross-company administration and operator escalation', async () => {
    await request(app.getHttpServer()).patch(`/users/${tenantB}/role`).set('Authorization', bearer(a.accessToken)).send({ role: 'OPERATOR' }).expect(404);
    await request(app.getHttpServer()).patch(`/users/${tenantA}/role`).set('Authorization', bearer(operator.accessToken)).send({ role: 'ADMIN' }).expect(403);
    await request(app.getHttpServer()).post('/users').set('Authorization', bearer(a.accessToken)).send({ name: 'Injected', email: `${prefix}-injected@test.local`, password, tenantId: tenantB }).expect(400);
    expect((await db.withTenant(tenantB, tx => tx.user.findUniqueOrThrow({ where: { id: tenantB } }))).role).toBe('ADMIN');
  });

  it('rotates once under concurrent refresh and revokes replayed sessions', async () => {
    const results = await Promise.all([1, 2].map(() => request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: a.refreshToken })));
    expect(results.map(r => r.status).sort()).toEqual([200, 401]);
    const success = results.find(r => r.status === 200)!;
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', bearer(success.body.data.accessToken)).expect(401);
  });

  it('enforces token expiry, server session expiry and logout', async () => {
    const jwt = new JwtService();
    const claims = jwt.decode<Record<string, unknown>>(a.accessToken);
    const expired = jwt.sign({ ...claims, exp: 1 }, { secret: keys.JWT_ACCESS_SECRET });
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', bearer(expired)).expect(401);
    await db.withTenant(tenantA, tx => tx.authSession.updateMany({ where: { userId: tenantA }, data: { expiresAt: new Date(0) } }));
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', bearer(a.accessToken)).expect(401);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: a.refreshToken }).expect(401);
    await request(app.getHttpServer()).post('/auth/logout').send({ refreshToken: b.refreshToken }).expect(200);
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', bearer(b.accessToken)).expect(401);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: b.refreshToken }).expect(401);
  });

  it('enforces sync-state RLS for unfiltered reads, missing context and foreign account references', async () => {
    const role = await db.$queryRaw<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    expect(role[0]).toMatchObject({ current_user: 'farmaecon_runtime', rolsuper: false, rolbypassrls: false });
    const policy = await db.$queryRaw<{ relrowsecurity: boolean; policyname: string }[]>`
      SELECT c.relrowsecurity, p.policyname FROM pg_class c
      JOIN pg_policies p ON p.tablename=c.relname AND p.schemaname='public'
      WHERE c.oid='public.marketplace_sync_states'::regclass`;
    expect(policy).toEqual([{ relrowsecurity: true, policyname: 'tenant_isolation' }]);
    for (const tenant of [tenantA, tenantB]) {
      const states = await db.withTenant(tenant, tx => tx.marketplaceSyncState.findMany());
      expect(states.map(s => s.tenantId)).toEqual([tenant]);
    }
    expect(await db.$queryRaw`SELECT * FROM public.marketplace_sync_states`).toEqual([]);
    await expect(db.withTenant(tenantA, tx => tx.$executeRaw`
      INSERT INTO public.marketplace_sync_states (id, tenant_id, marketplace_account_id, updated_at)
      VALUES (${randomUUID()}, ${tenantA}, ${tenantB}, NOW())`)).rejects.toThrow(/row-level security policy/);
    expect(await db.withTenant(tenantA, tx => tx.marketplaceSyncState.count())).toBe(1);
  });

  it('queues later windows independently and persists their pages using the restricted role', async () => {
    const host = process.env.REDIS_HOST ?? 'localhost';
    if (!['localhost', '127.0.0.1'].includes(host)) throw new Error('Loopback test Redis is required');
    const accountId = `${prefix}-sync`;
    // A unique queue with no worker: only this test can consume/clean its jobs.
    const queue = new Queue(`resumable-test-${randomUUID()}`, {
      connection: { host, port: Number(process.env.REDIS_PORT ?? 6379), maxRetriesPerRequest: 1 },
    });
    try {
      await owner.marketplaceAccount.create({ data: {
        id: accountId, tenantId: tenantA, platform: 'MERCADO_LIVRE', source: 'MERCADO_LIVRE', name: 'Synthetic paginated source',
      } });
      const provider = { listSellerOrdersPageInWindow: jest.fn(async (_id: string, _tenant: string, options: { offset: number }) => {
        const count = Math.min(50, 51 - options.offset);
        return {
          results: Array.from({ length: count }, (_, i) => ({ id: options.offset + i + 1, currency_id: 'BRL',
            total_amount: 1, date_created: new Date().toISOString(), status: 'paid' })),
          offset: options.offset, limit: 50, total: 51, nextOffset: options.offset + count,
          complete: options.offset + count === 51,
        };
      }) };
      const sync = new MlOrdersSyncService(db, provider as never, queue);
      for (let cycle = 0; cycle < 2; cycle++) {
        expect((await inTenant(tenantA, () => sync.syncRecentOrders(accountId, tenantA))).status).toBe('PARTIAL');
        expect((await inTenant(tenantA, () => sync.syncRecentOrders(accountId, tenantA))).status).toBe('COMPLETE');
      }
      const jobs = await queue.getJobs(['waiting']);
      expect(jobs).toHaveLength(2); // Retaining the old continuation must not suppress the next cycle.
      expect(new Set(jobs.map(job => job.id)).size).toBe(2);
      expect(jobs.every(job => job.data.accountId === accountId && job.data.tenantId === tenantA)).toBe(true);
      expect(provider.listSellerOrdersPageInWindow.mock.calls.map(call => call[2].offset)).toEqual([0, 50, 0, 50]);
      expect(await db.withTenant(tenantA, tx => tx.order.count({ where: { marketplaceAccountId: accountId } }))).toBe(51);
    } finally {
      try { await queue.obliterate({ force: true }); }
      finally {
        await queue.close();
        await owner.marketplaceAccount.deleteMany({ where: { id: accountId, tenantId: tenantA } });
      }
    }
  }, 30000);
});
