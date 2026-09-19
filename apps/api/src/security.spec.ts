import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Global, Module, ValidationPipe, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { MemoryPrisma } from '../test/memory-prisma';
import { PrismaService } from './shared/prisma/prisma.service';
import { AuthModule } from './modules/auth/auth.module';
import { AuthService } from './modules/auth/auth.service';
import { UsersController } from './modules/users/users.controller';
import { UsersService } from './modules/users/users.service';
import { OrdersController } from './modules/orders/orders.controller';
import { OrdersService } from './modules/orders/orders.service';
import { ObservationController } from './modules/observation/observation.controller';
import { ObservationService } from './modules/observation/observation.service';
import { IntegrationsService } from './modules/integrations/integrations.service';

const keys = { JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex') };
let db: MemoryPrisma;
@Global() @Module({ providers: [{ provide: PrismaService, useFactory: () => db }], exports: [PrismaService] }) class TestDb {}
describe('Authenticated HTTP security boundaries', () => {
  let app: INestApplication; let auth: AuthService;
  let a: {accessToken:string;refreshToken:string}; let b: typeof a; let operator: typeof a;
  const password = randomBytes(24).toString('hex');
  beforeEach(async () => {
    db = new MemoryPrisma();
    for (const [id,tenantId,role] of [['admin-a','a','ADMIN'],['operator-a','a','OPERATOR'],['admin-b','b','ADMIN']]) db.rows.user.push({id,tenantId,role,email:`${id}@test.local`,name:id,password:await bcrypt.hash(password,4)});
    for (const tenantId of ['a','b']) {
      db.rows.marketplaceAccount.push({id:`account-${tenantId}`,tenantId,platform:'MERCADO_LIVRE',name:tenantId,status:'ACTIVE',source:'SIMULATED',lastSyncedAt:new Date(),accessToken:'sensitive-access-sentinel',refreshToken:'sensitive-refresh-sentinel'});
      db.rows.order.push({id:`order-${tenantId}`,tenantId,marketplaceAccountId:`account-${tenantId}`,externalOrderId:`external-${tenantId}`,status:'PAID',totalAmount:125,createdAt:new Date()});
    }
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({isGlobal:true,ignoreEnvFile:true,load:[()=>keys]}),TestDb,AuthModule],
      controllers:[UsersController,OrdersController,ObservationController], providers:[UsersService,OrdersService,ObservationService] }).compile();
    app=module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true})); await app.listen(0, '127.0.0.1');
    auth=module.get(AuthService);
    a=await auth.login({id:'admin-a',tenantId:'a'});b=await auth.login({id:'admin-b',tenantId:'b'});operator=await auth.login({id:'operator-a',tenantId:'a'});
  });
  afterEach(async()=>app.close());
  const bearer=(token:string)=>`Bearer ${token}`;
  it('logs in, rejects invalid credentials, and requires authentication',async()=>{
    await request(app.getHttpServer()).post('/auth/login').send({email:'admin-a@test.local',password}).expect(200);
    await request(app.getHttpServer()).post('/auth/login').send({email:'admin-a@test.local',password:'incorrect'}).expect(401);
    await request(app.getHttpServer()).get('/orders').expect(401);
  });
  it('explicit selections never expose tokens in order detail, list or accounts',async()=>{
    for(const path of ['/orders','/orders/order-a']) {
      const r=await request(app.getHttpServer()).get(path).set('Authorization',bearer(a.accessToken)).expect(200);
      expect(JSON.stringify(r.body)).not.toMatch(/sensitive-|accessToken|refreshToken|password|tenantId/);
    }
    const integrations=new IntegrationsService(db as any,{} as any,{} as any);
    const accounts=await integrations.findAll('a');
    expect(accounts).toHaveLength(1);expect(JSON.stringify(accounts)).not.toMatch(/sensitive-|accessToken|refreshToken|password/);
  });
  it('isolates lists, report and detail across two companies',async()=>{
    const orders=await request(app.getHttpServer()).get('/orders').set('Authorization',bearer(a.accessToken)).expect(200);
    expect(orders.body.data.map((o:any)=>o.id)).toEqual(['order-a']);
    const hidden=await request(app.getHttpServer()).get('/orders/order-b').set('Authorization',bearer(a.accessToken));
    expect(hidden.status).not.toBe(200);expect(JSON.stringify(hidden.body)).not.toContain('external-b');
    const report=await request(app.getHttpServer()).get('/observation/report').set('Authorization',bearer(b.accessToken)).expect(200);
    expect(report.body.data.sources.map((s:any)=>s.id)).toEqual(['account-b']);
    expect(report.body.data.financial.netProfit).toBeNull();expect(report.body.data.financial.complete).toBe(false);
  });
  it('rejects operator privilege escalation and tenant injection',async()=>{
    await request(app.getHttpServer()).post('/users').set('Authorization',bearer(operator.accessToken)).send({name:'x',email:'x@test.local',password,role:'ADMIN'}).expect(403);
    await request(app.getHttpServer()).patch('/users/operator-a/role').set('Authorization',bearer(operator.accessToken)).send({role:'ADMIN'}).expect(403);
    await request(app.getHttpServer()).post('/users').set('Authorization',bearer(a.accessToken)).send({name:'x',email:'x@test.local',password,role:'ADMIN',tenantId:'b'}).expect(400);
    await request(app.getHttpServer()).patch('/users/admin-b/role').set('Authorization',bearer(a.accessToken)).send({role:'OPERATOR'}).expect(404);
    expect(db.rows.user.find(u=>u.id==='admin-b').role).toBe('ADMIN');
  });
  it('allows admin creation only in their tenant and revokes sessions after role changes',async()=>{
    const created=await request(app.getHttpServer()).post('/users').set('Authorization',bearer(a.accessToken)).send({name:'x',email:'x@test.local',password,role:'OPERATOR'}).expect(201);
    expect(created.body.data).not.toHaveProperty('password');expect(db.rows.user.at(-1).tenantId).toBe('a');
    await request(app.getHttpServer()).patch('/users/operator-a/role').set('Authorization',bearer(a.accessToken)).send({role:'MANAGER'}).expect(200);
    await request(app.getHttpServer()).get('/auth/me').set('Authorization',bearer(operator.accessToken)).expect(401);
  });
  it('separates access/refresh purpose and rejects forged or expired access tokens',async()=>{
    await request(app.getHttpServer()).get('/auth/me').set('Authorization',bearer(a.refreshToken)).expect(401);
    await request(app.getHttpServer()).post('/auth/refresh').send({refreshToken:a.accessToken}).expect(401);
    const jwt=new JwtService();const claims=jwt.decode(a.accessToken) as any;
    for (const patch of [{purpose:'refresh'},{exp:1}]) {
      const token=jwt.sign({...claims,...patch},{secret:keys.JWT_ACCESS_SECRET});
      await request(app.getHttpServer()).get('/auth/me').set('Authorization',bearer(token)).expect(401);
    }
    const forged=jwt.sign(claims,{secret:randomBytes(32).toString('hex')});
    await request(app.getHttpServer()).get('/auth/me').set('Authorization',bearer(forged)).expect(401);
    const refreshClaims=jwt.decode(a.refreshToken) as any;
    const expired=jwt.sign({...refreshClaims,exp:1},{secret:keys.JWT_REFRESH_SECRET});
    await request(app.getHttpServer()).post('/auth/refresh').send({refreshToken:expired}).expect(401);
  });
  it('rotates refresh tokens and revokes the session on replay',async()=>{
    const next=await request(app.getHttpServer()).post('/auth/refresh').send({refreshToken:a.refreshToken}).expect(200);
    expect(next.body.data.refreshToken).not.toBe(a.refreshToken);
    expect(db.rows.authSession[0].refreshHash).not.toBe(next.body.data.refreshToken);
    await request(app.getHttpServer()).post('/auth/refresh').send({refreshToken:a.refreshToken}).expect(401);
    await request(app.getHttpServer()).get('/auth/me').set('Authorization',bearer(next.body.data.accessToken)).expect(401);
  });
  it('logout revokes access and refresh, and server-side expiry is enforced',async()=>{
    await request(app.getHttpServer()).post('/auth/logout').send({refreshToken:a.refreshToken}).expect(200);
    await request(app.getHttpServer()).get('/auth/me').set('Authorization',bearer(a.accessToken)).expect(401);
    await request(app.getHttpServer()).post('/auth/refresh').send({refreshToken:a.refreshToken}).expect(401);
    db.rows.authSession.find(s=>s.userId==='admin-b').expiresAt=new Date(0);
    await request(app.getHttpServer()).get('/auth/me').set('Authorization',bearer(b.accessToken)).expect(401);
  });
});
