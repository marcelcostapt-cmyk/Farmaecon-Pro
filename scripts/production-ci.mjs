import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { productionDefaults, validateProduction } from './production-env.mjs';

// Disposable CI installation. Uses production settings, no real domains/accounts.
const project = `farmaecon-prod-ci-${randomUUID().slice(0, 8)}`;
const directory = resolve('.local', project);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const file = `${directory}/environment`;
const backupDirectory = `${directory}/backups`;
const fixture = {
  ...productionDefaults(), API_IMAGE: 'farmaecon-api-check:ci', WEB_IMAGE: 'farmaecon-web-check:ci',
  APP_DOMAIN: 'app.farmaecon.test', API_DOMAIN: 'api.farmaecon.test',
  OWNER_EMAIL: 'owner@production.local', OWNER_NAME: 'CI Owner', COMPANY_NAME: 'CI Company',
};
validateProduction(fixture);
writeFileSync(file, Object.entries(fixture).map(([k,v]) => `${k}=${v}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
const override = `${directory}/ports.yml`;
writeFileSync(override, 'services:\n  api:\n    ports: ["127.0.0.1::3001"]\n  web:\n    ports: ["127.0.0.1::3000"]\n', { mode: 0o600 });
const args = ['compose', '--env-file', file, '-p', project, '-f', 'docker-compose.prod.yml', '-f', override];
const env = { ...process.env, ...fixture, FARMAECON_PRODUCTION_ENV: file, FARMAECON_COMPOSE_PROJECT: project, FARMAECON_BACKUP_DIR: backupDirectory };
function run(command, arguments_, { allowFailure = false, log = false } = {}) {
  const result = spawnSync(command, arguments_, { env, encoding: 'utf8', timeout: 240000 });
  if (result.error || (!allowFailure && result.status !== 0)) throw new Error(`Production CI command failed: ${command} ${arguments_.slice(0, 1).join(' ')}`);
  if (log && result.stdout) console.log(result.stdout.trim());
  return result;
}
const compose = (more, options) => run('docker', [...args, ...more], options);
try {
  compose(['up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '180']);
  compose(['run', '--rm', '--no-deps', 'bootstrap']);
  assert.notEqual(compose(['run', '--rm', '--no-deps', 'bootstrap'], { allowFailure: true }).status, 0, 'Bootstrap must refuse to overwrite existing users');
  compose(['run', '--rm', '--no-deps', 'migrate']); // Deploy migrations are repeatable.
  const apiPort = compose(['port', 'api', '3001']).stdout.trim();
  const webPort = compose(['port', 'web', '3000']).stdout.trim();
  assert(/^127\.0\.0\.1:\d+$/.test(apiPort) && /^127\.0\.0\.1:\d+$/.test(webPort));
  const request = (path, init = {}) => fetch(`http://${apiPort}/api/v1${path}`, { ...init, signal: AbortSignal.timeout(5000) });
  assert.equal((await request('/ready')).status, 200);
  assert.equal((await fetch(`http://${webPort}/login`, { signal: AbortSignal.timeout(5000) })).status, 200);
  const protectedPage = await fetch(`http://${webPort}/dashboard`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  assert([302, 303, 307, 308].includes(protectedPage.status));
  assert.equal(new URL(protectedPage.headers.get('location'), `http://${webPort}`).pathname, '/login');
  const login = await request('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: fixture.OWNER_EMAIL, password: fixture.OWNER_PASSWORD }) });
  assert.equal(login.status, 200);
  const session = (await login.json()).data;
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const reportResponse = await request('/observation/report', { headers });
  assert.equal(reportResponse.status, 200);
  const report = (await reportResponse.json()).data;
  assert.equal(report.orderCount, 0);
  assert.equal(report.financial.netProfit, null);
  assert.equal(report.mode, 'OBSERVATION');
  assert(!/accessToken|refreshToken|password|verifier/.test(JSON.stringify(report)));
  compose(['restart', 'db', 'redis']);
  let ready = false;
  for (let i = 0; i < 45; i++) {
    try { ready = (await request('/ready')).status === 200; } catch { ready = false; }
    if (ready) break;
    await delay(1000);
  }
  assert(ready, 'Dependencies must recover after restart');
  assert.equal((await request('/auth/me', { headers })).status, 200, 'Session must persist across database restart');
  run(process.execPath, ['scripts/production-backup.mjs', 'backup'], { log: true });
  const encrypted = readdirSync(backupDirectory).filter(p => p.endsWith('.pgdump.enc'));
  assert.equal(encrypted.length, 1);
  run(process.execPath, ['scripts/production-backup.mjs', 'verify-restore', `${backupDirectory}/${encrypted[0]}`], { log: true });
  console.log('PASS: production images, migrations, bootstrap, login, private report, dependency restart, encrypted backup and isolated restore.');
} finally {
  // Only this randomly named, newly created CI project's volumes are removed.
  compose(['down', '--volumes', '--remove-orphans']);
}
