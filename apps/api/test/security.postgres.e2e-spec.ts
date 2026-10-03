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

const keys = { JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex') };
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
class TestDatabase {}

describe('PostgreSQL HTTP security boundaries', () => {
  let app: INestApplication;
  let db: PrismaService;
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
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => keys] }), TestDatabase, AuthModule],
      controllers: [UsersController, OrdersController, ObservationController],
      providers: [UsersService, OrdersService, ObservationService],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    db = module.get(PrismaService); auth = module.get(AuthService);
    for (const tenantId of [tenantA, tenantB]) {
      await db.tenant.create({ data: { id: tenantId, name: tenantId } });
      await db.marketplaceAccount.create({ data: { id: tenantId, tenantId, platform: 'MERCADO_LIVRE', name: tenantId, source: 'SIMULATED', accessToken: 'sentinel-access', refreshToken: 'sentinel-refresh', lastSyncedAt: new Date() } });
      await db.order.create({ data: { id: tenantId, tenantId, marketplaceAccountId: tenantId, externalOrderId: tenantId, totalAmount: 125.5, status: 'PAID' } });
      await db.user.create({ data: { id: tenantId, tenantId, name: 'Admin', email: `${tenantId}@test.local`, password: await bcrypt.hash(password, 4), role: 'ADMIN' } });
    }
    await db.user.create({ data: { id: `${prefix}-operator`, tenantId: tenantA, name: 'Operator', email: `${prefix}-operator@test.local`, password: await bcrypt.hash(password, 4), role: 'OPERATOR' } });
  }, 30000);

  beforeEach(async () => {
    a = await auth.login({ id: tenantA, tenantId: tenantA });
    b = await auth.login({ id: tenantB, tenantId: tenantB });
    operator = await auth.login({ id: `${prefix}-operator`, tenantId: tenantA });
  });

  afterAll(async () => {
    if (db) {
      await db.authSession.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      await db.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
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
      safe(await new IntegrationsService(db, {} as never, {} as never).findAll(tenant));
    }
    await request(app.getHttpServer()).get(`/orders/${tenantB}`).set('Authorization', bearer(a.accessToken)).expect(404);
  });

  it('rejects cross-company administration and operator escalation', async () => {
    await request(app.getHttpServer()).patch(`/users/${tenantB}/role`).set('Authorization', bearer(a.accessToken)).send({ role: 'OPERATOR' }).expect(404);
    await request(app.getHttpServer()).patch(`/users/${tenantA}/role`).set('Authorization', bearer(operator.accessToken)).send({ role: 'ADMIN' }).expect(403);
    await request(app.getHttpServer()).post('/users').set('Authorization', bearer(a.accessToken)).send({ name: 'Injected', email: `${prefix}-injected@test.local`, password, tenantId: tenantB }).expect(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: tenantB } })).role).toBe('ADMIN');
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
    await db.authSession.updateMany({ where: { userId: tenantA }, data: { expiresAt: new Date(0) } });
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', bearer(a.accessToken)).expect(401);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: a.refreshToken }).expect(401);
    await request(app.getHttpServer()).post('/auth/logout').send({ refreshToken: b.refreshToken }).expect(200);
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', bearer(b.accessToken)).expect(401);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: b.refreshToken }).expect(401);
  });
});
