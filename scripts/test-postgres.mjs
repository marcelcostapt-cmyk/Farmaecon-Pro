import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

// Only create and delete our uniquely named database on a local test server.
const source = new URL(process.env.DATABASE_URL ?? 'http://missing');
if (!['127.0.0.1', 'localhost'].includes(source.hostname) || process.env.LOCAL_SIMULATION !== 'true' || process.env.MARKETPLACE_SOURCE !== 'MOCK') {
  throw new Error('Use the local simulation configuration');
}
const database = `farmaecon_test_${randomBytes(8).toString('hex')}`;
const adminUrl = new URL(source); adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5000 });
await admin.connect();
let created = false;
try {
  await admin.query(`CREATE DATABASE "${database}"`); created = true;
  source.pathname = `/${database}`;
  const env = { ...process.env, DATABASE_URL: source.toString(), FARMAECON_ENV_FILE: '.missing-test-env',
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'), MARKETPLACE_SOURCE: 'MOCK', MARKETPLACE_MODE: 'OBSERVATION' };
  const migrate = spawnSync(process.execPath, ['scripts/database-migrate.mjs'], { env, stdio: 'inherit' });
  if (migrate.status !== 0) throw new Error('Isolated migrations/runtime role preparation failed');
  const runtime = new URL(source);
  runtime.username = 'farmaecon_runtime'; runtime.password = process.env.RUNTIME_DB_PASSWORD;
  const run = spawnSync('npm', ['run', 'test:e2e', '--workspace=api', '--', '--runInBand'], {
    env: { ...env, DATABASE_URL: runtime.toString(), TEST_OWNER_DATABASE_URL: source.toString() }, stdio: 'inherit',
  });
  if (run.status !== 0) throw new Error(`PostgreSQL validation failed (${run.status ?? 'spawn error'})`);
  console.log('PASS: migrations and security suite against isolated real PostgreSQL');
} finally {
  if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
