import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

// Only creates and destroys its own random database on the loopback test server.
const source = new URL(process.env.DATABASE_URL ?? '');
if (process.env.LOCAL_SIMULATION !== 'true' || process.env.MARKETPLACE_SOURCE !== 'MOCK'
  || !['127.0.0.1', 'localhost'].includes(source.hostname) || source.pathname !== '/farmaecon_observation') throw new Error('Isolated observation PostgreSQL required');
const name = `farmaecon_upgrade_${randomUUID().replaceAll('-', '')}`;
const target = new URL(source); target.pathname = `/${name}`;
const admin = new pg.Client({ connectionString: source.toString() });
let database;
let created = false;
const oldMigrations = ['20260419_postgres_foundation', '20260918_observation_security'];
function prisma(args) {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args, '--config', 'apps/api/prisma.config.ts'], {
    env: { ...process.env, DATABASE_URL: target.toString() }, encoding: 'utf8', timeout: 60000,
  });
  assert(result.status === 0, `Isolated Prisma migration command failed: ${args.slice(0, 2).join(' ')}`);
}
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  database = new pg.Client({ connectionString: target.toString() }); await database.connect();
  for (const migration of oldMigrations) {
    await database.query(readFileSync(`apps/api/prisma/migrations/${migration}/migration.sql`, 'utf8'));
    prisma(['migrate', 'resolve', '--applied', migration]);
  }
  for (const key of ['a', 'b']) {
    await database.query('INSERT INTO tenants (id, name, updated_at) VALUES ($1, $2, NOW())', [`upgrade-${key}`, `Upgrade company ${key}`]);
    await database.query("INSERT INTO marketplace_accounts (id, tenant_id, platform, name, source, last_synced_at, updated_at) VALUES ($1, $2, 'MERCADO_LIVRE', $3, 'SIMULATED', '2026-09-01T12:00:00Z', NOW())", [`upgrade-account-${key}`, `upgrade-${key}`, 'Synthetic migration account']);
    await database.query("INSERT INTO orders (id, tenant_id, marketplace_account_id, external_order_id, total_amount, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'PAID', '2026-09-01T10:30:00Z', NOW())", [`upgrade-order-${key}`, `upgrade-${key}`, `upgrade-account-${key}`, `test-${key}`, key === 'a' ? 123.45 : 0]);
  }
  const before = (await database.query('SELECT * FROM orders ORDER BY id')).rows;
  prisma(['migrate', 'deploy']);
  prisma(['migrate', 'deploy']);
  const after = (await database.query('SELECT * FROM orders ORDER BY id')).rows;
  assert.deepEqual(after, before, 'Existing orders must survive upgrade unchanged');
  const accounts = (await database.query('SELECT last_sync_state, last_sync_attempt_at, last_sync_error, last_synced_at FROM marketplace_accounts')).rows;
  assert(accounts.length === 2 && accounts.every(a => a.last_sync_state === 'NOT_SYNCED' && a.last_sync_attempt_at === null && a.last_sync_error === null && a.last_synced_at), 'Upgrade must preserve timestamps without claiming previous complete sync evidence');
  const migrations = (await database.query('SELECT COUNT(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows[0].count;
  assert(migrations === 3, 'All current migrations must be applied');
  console.log('PASS: populated previous schema upgraded twice with both tenants, monetary values and dates preserved; new synchronization evidence starts uncertified.');
} finally {
  await database?.end();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
