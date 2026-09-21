import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
const require = createRequire(import.meta.url);
const { MlOAuthService } = require('../apps/api/dist/src/modules/integrations/ml-oauth.service.js');
const { TokenVault } = require('../apps/api/dist/src/shared/security/token-vault.service.js');
const { hashToken } = require('../apps/api/dist/src/modules/auth/auth.service.js');

const url = new URL(process.env.DATABASE_URL ?? '');
if (process.env.LOCAL_SIMULATION !== 'true' || process.env.MARKETPLACE_SOURCE !== 'MOCK'
  || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/farmaecon_observation') throw new Error('Only the isolated observation database may run these tests');
const db = new PrismaClient({ adapter: new PrismaPg(url.toString()) });
const base = 'http://127.0.0.1:3001/api/v1';
async function api(path, { token, method = 'GET', body, status = 200 } = {}) {
  const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
  assert(response.status === status, `Unexpected status for ${method} ${path}: ${response.status}`);
  return response.json();
}
const jwt = new JwtService();
const stateHashes = [];
let createdAccountId;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const destination = new URL(String(input));
  assert(destination.origin === 'http://127.0.0.1:3001', 'External network blocked during PostgreSQL security tests');
  return originalFetch(input, init);
};
try {
  const login = async key => (await api('/auth/login', { method: 'POST', body: { email: `admin-${key}@observation.local`, password: process.env[`DEMO_ADMIN_${key.toUpperCase()}_PASSWORD`] } })).data;
  const a = await login('a'); const b = await login('b');
  const claims = jwt.decode(a.accessToken);
  for (const [kind, token, key] of [['access', a.accessToken, 'JWT_ACCESS_SECRET'], ['refresh', a.refreshToken, 'JWT_REFRESH_SECRET']]) {
    const expired = jwt.sign({ ...jwt.decode(token), exp: 1 }, { secret: process.env[key] });
    if (kind === 'access') await api('/auth/me', { token: expired, status: 401 });
    else await api('/auth/refresh', { method: 'POST', body: { refreshToken: expired }, status: 401 });
  }
  await api('/auth/me', { token: a.refreshToken, status: 401 });
  await api('/auth/refresh', { method: 'POST', body: { refreshToken: a.accessToken }, status: 401 });
  const ordersA = (await api('/orders', { token: a.accessToken })).data;
  const ordersB = (await api('/orders', { token: b.accessToken })).data;
  assert(ordersA.length === 2 && ordersB.length === 2, 'Run the simulated synchronization first');
  await api(`/orders/${ordersB[0].id}`, { token: a.accessToken, status: 404 });
  const foreignOrders = await db.order.count({ where: { tenantId: 'observation-b' } });
  assert(foreignOrders === 2, 'The second tenant must have real PostgreSQL rows');
  const actor = { sub: claims.sub, tenantId: claims.tenantId, sid: claims.sid, role: 'ADMIN', email: 'admin-a@observation.local' };
  const config = new ConfigService({ MARKETPLACE_SOURCE: 'MERCADO_LIVRE', ML_PKCE_ENABLED: 'true', ML_APP_ID: 'synthetic-only', ML_SECRET_KEY: randomBytes(32).toString('hex'),
    ML_REDIRECT_URI: 'https://app.farmaecon.test/auth/callback', TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') });
  const vault = new TokenVault(config);
  let tokenRequests = 0;
  const remoteAccess = randomBytes(24).toString('base64url'); const remoteRefresh = randomBytes(24).toString('base64url');
  const http = { async request() { tokenRequests++; return { ok: true, json: async () => ({ access_token: remoteAccess, refresh_token: remoteRefresh, expires_in: 3600, user_id: 987654321 }) }; } };
  const oauth = new MlOAuthService(config, db, { add: async () => {} }, vault, http);
  const begin = async () => {
    const state = new URL((await oauth.buildAuthorizationUrl(actor)).url).searchParams.get('state');
    stateHashes.push(hashToken(state)); return state;
  };
  for (const failure of ['invalid', 'expired', 'user', 'tenant', 'session']) {
    let state = await begin(); let principal = { ...actor };
    if (failure === 'invalid') state = randomBytes(32).toString('base64url');
    if (failure === 'expired') await db.oAuthState.update({ where: { stateHash: hashToken(state) }, data: { expiresAt: new Date(0) } });
    if (failure === 'user') principal.sub = 'admin-b';
    if (failure === 'tenant') principal.tenantId = 'observation-b';
    if (failure === 'session') principal.sid = randomUUID();
    await assert.rejects(oauth.exchangeCode('fixture-code', state, principal));
  }
  assert(tokenRequests === 0, 'Invalid OAuth state reached the provider adapter');
  const state = await begin();
  const outcomes = await Promise.allSettled([oauth.exchangeCode('fixture-code', state, actor), oauth.exchangeCode('fixture-code', state, actor)]);
  assert(outcomes.filter(x => x.status === 'fulfilled').length === 1 && tokenRequests === 1, 'PostgreSQL must atomically consume OAuth state once');
  createdAccountId = outcomes.find(x => x.status === 'fulfilled').value.accountId;
  await assert.rejects(oauth.exchangeCode('fixture-code', state, actor));
  const account = await db.marketplaceAccount.findUniqueOrThrow({ where: { id: createdAccountId } });
  assert(account.accessToken.startsWith('v1.') && account.accessToken !== remoteAccess && account.refreshToken !== remoteRefresh, 'Tokens must be encrypted in PostgreSQL');
  assert.throws(() => vault.decrypt(account.accessToken, 'observation-b:987654321'));
  const publicAccounts = await api('/integrations', { token: a.accessToken });
  assert(!/accessToken|refreshToken|access_token|refresh_token|verifier/.test(JSON.stringify(publicAccounts)), 'Sensitive field in account response');
  await db.authSession.update({ where: { id: claims.sid }, data: { expiresAt: new Date(0) } });
  await api('/auth/me', { token: a.accessToken, status: 401 });
  await api('/auth/refresh', { method: 'POST', body: { refreshToken: a.refreshToken }, status: 401 });
  const cleanup = spawnSync(process.execPath, ['scripts/clear-marketplace-credentials.mjs', '--all-mercado-livre'], {
    env: { ...process.env, FARMAECON_CLEAR_MARKETPLACE_CREDENTIALS: 'confirmed' }, encoding: 'utf8', timeout: 30000,
  });
  assert(cleanup.status === 0, 'Credential cleanup failed in isolated test database');
  const cleared = await db.marketplaceAccount.findUniqueOrThrow({ where: { id: createdAccountId } });
  assert(cleared.accessToken === null && cleared.refreshToken === null && cleared.expiresAt === null && cleared.status === 'DISCONNECTED');
  console.log('PASS: PostgreSQL-backed tenant isolation, token purpose/expiry, session expiry, invalid/expired/cross-tenant/replayed OAuth, concurrent single use, vault encryption and credential cleanup. Provider calls were replaced by an in-process fixture.');
} finally {
  globalThis.fetch = originalFetch;
  await db.oAuthState.deleteMany({ where: { stateHash: { in: stateHashes } } });
  if (createdAccountId) await db.marketplaceAccount.delete({ where: { id: createdAccountId } });
  await db.$disconnect();
}
