import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { Prisma } from '@prisma/client';
import { runtimeGrantsSql } from './runtime-grants.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const databaseName = 'restore_grants_test';
// No .env file, inherited database URL, Docker TCP host, or production name is used.
const baseEnv = Object.fromEntries(['PATH', 'HOME', 'SystemRoot'].filter(key => process.env[key]).map(key => [key, process.env[key]]));

test('ACL-free restore repairs runtime access with no pending migrations and keeps tenant boundaries', { timeout: 720_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'farmaecon-restore-grants-test-'));
  const containers = [];
  const clients = new Set();
  const secrets = [];
  const failures = [];
  let dockerHost;
  const secret = () => { const value = randomBytes(32).toString('base64url'); secrets.push(value); return value; };
  const sanitize = value => secrets.reduce((text, value) => text.replaceAll(value, '[REDACTED]'), String(value));

  async function command(label, executable, args, { env = baseEnv, input, timeout = 30_000 } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
      const stdout = [], stderr = [];
      let bytes = 0, problem;
      const timer = setTimeout(() => { problem = 'timed out'; child.kill('SIGKILL'); }, timeout);
      const collect = chunks => chunk => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) { problem = 'exceeded the bounded output limit'; child.kill('SIGKILL'); }
        else chunks.push(chunk);
      };
      child.stdout.on('data', collect(stdout));
      child.stderr.on('data', collect(stderr));
      child.stdin.on('error', () => {}); // Report the process failure rather than an EPIPE.
      child.once('error', error => { problem = error.code ?? 'could not start'; });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        if (problem || code !== 0) {
          const diagnostic = sanitize(Buffer.concat(stderr).toString('utf8') + Buffer.concat(stdout).toString('utf8')).slice(-6000);
          reject(new Error(`${label}: ${problem ?? `exit ${code}, signal ${signal ?? 'none'}`}${diagnostic ? `\n${diagnostic}` : ''}`));
        } else resolve(Buffer.concat(stdout));
      });
      child.stdin.end(input);
    });
  }

  const docker = (label, args, options) => command(label, 'docker', ['--host', dockerHost, ...args], options);
  const config = (cluster, user = 'postgres', password = cluster.password) => ({
    host: '127.0.0.1', port: cluster.port, database: databaseName, user, password,
    ssl: false, connectionTimeoutMillis: 1500, query_timeout: 10_000, statement_timeout: 10_000,
  });
  async function connect(cluster, user, password) {
    const client = new pg.Client(config(cluster, user, password));
    client.on('error', () => {}); // Pending/subsequent queries still reject after a connection loss.
    clients.add(client);
    await client.connect();
    return client;
  }
  async function startCluster(kind) {
    const cluster = { name: `farmaecon-restore-grants-${kind}-${randomUUID()}`, password: secret() };
    containers.push(cluster.name); // Also clean up a container whose startup command times out.
    await docker(`start disposable ${kind} PostgreSQL`, [
      'run', '--detach', '--name', cluster.name, '--publish', '127.0.0.1::5432',
      '--memory', '768m', '--tmpfs', '/var/lib/postgresql/data',
      '--env', 'POSTGRES_PASSWORD', '--env', `POSTGRES_DB=${databaseName}`, 'postgres:15-alpine',
    ], { env: { ...baseEnv, POSTGRES_PASSWORD: cluster.password }, timeout: 180_000 });
    const bindings = JSON.parse((await docker(`inspect disposable ${kind} port`, [
      'inspect', '--format', '{{json (index .NetworkSettings.Ports "5432/tcp")}}', cluster.name,
    ])).toString('utf8'));
    assert.equal(bindings.length, 1, 'Disposable database must have exactly one published binding');
    assert.equal(bindings[0].HostIp, '127.0.0.1', 'Disposable database must bind only to loopback');
    cluster.port = Number(bindings[0].HostPort);
    assert(Number.isInteger(cluster.port) && cluster.port > 0 && cluster.port <= 65535, 'Docker must assign a valid ephemeral port');
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const probe = new pg.Client(config(cluster));
      try {
        await probe.connect();
        assert.equal((await probe.query('SELECT 1 AS ready')).rows[0].ready, 1);
        return cluster;
      } catch { await delay(500); }
      finally { await probe.end().catch(() => {}); }
    }
    throw new Error(`Disposable ${kind} PostgreSQL did not become ready over loopback within 45 seconds`);
  }
  async function migrate(cluster, runtimePassword) {
    const url = new URL(`postgresql://postgres@127.0.0.1:${cluster.port}/${databaseName}`);
    url.password = cluster.password;
    secrets.push(url.toString());
    await command('real database-migrate entrypoint', process.execPath, ['scripts/database-migrate.mjs'], {
      env: { ...baseEnv, CI: 'true', FARMAECON_ENV_FILE: '.missing-restore-test-env',
        DATABASE_URL: url.toString(), RUNTIME_DB_PASSWORD: runtimePassword }, timeout: 150_000,
    });
  }
  const history = async client => (await client.query('SELECT * FROM public._prisma_migrations ORDER BY migration_name, id')).rows;
  async function privileges(client, table) {
    return (await client.query(`SELECT
      has_table_privilege('farmaecon_runtime', $1, 'SELECT') AS select,
      has_table_privilege('farmaecon_runtime', $1, 'INSERT') AS insert,
      has_table_privilege('farmaecon_runtime', $1, 'UPDATE') AS update,
      has_table_privilege('farmaecon_runtime', $1, 'DELETE') AS delete`, [table])).rows[0];
  }
  async function publicLookupAllowed(client) {
    return (await client.query(`SELECT EXISTS (
      SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
      WHERE p.oid = 'public.farmaecon_login_lookup(text)'::regprocedure
        AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) AS allowed`)).rows[0].allowed;
  }
  const denied = (operation, message) => assert.rejects(operation, { code: '42501' }, message);

  try {
    const endpoint = (await command('read local Docker context', 'docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { timeout: 5000 })).toString('utf8').trim();
    assert.match(endpoint, /^unix:\/\//, 'This test requires a local Docker Unix socket; remote Docker hosts are forbidden');
    dockerHost = endpoint;
    try { await docker('local Docker readiness', ['info', '--format', '{{.ServerVersion}}'], { timeout: 12_000 }); }
    catch (error) { throw new Error(`Local Docker is unavailable or still starting. This PostgreSQL integration test fails rather than skips. ${sanitize(error.message)}`); }

    const source = await startCluster('source');
    const target = await startCluster('target');
    const runtimePassword = secret();
    await migrate(source, runtimePassword);
    const sourceOwner = await connect(source);
    const sourceHistory = await history(sourceOwner);
    const migrations = (await readdir(join(root, 'apps/api/prisma/migrations'), { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    assert.deepEqual(sourceHistory.map(row => row.migration_name), migrations, 'Source must apply every checked-out migration');
    assert(sourceHistory.every(row => row.finished_at && !row.rolled_back_at), 'Every source migration must be complete');
    assert(migrations.includes('20261011_order_pagination_recovery'), 'The recovery migration must be exercised');
    assert.equal(await publicLookupAllowed(sourceOwner), false, 'Source login lookup must not be executable by PUBLIC');
    for (const suffix of ['a', 'b']) {
      await sourceOwner.query('INSERT INTO public.tenants (id, name, updated_at) VALUES ($1, $2, NOW())', [`restore-tenant-${suffix}`, `Synthetic restore tenant ${suffix}`]);
      await sourceOwner.query(`INSERT INTO public.marketplace_accounts (id, tenant_id, platform, name, source, updated_at)
        VALUES ($1, $2, 'MERCADO_LIVRE', $3, 'SIMULATED', NOW())`, [`restore-account-${suffix}`, `restore-tenant-${suffix}`, 'Synthetic restore account']);
    }
    await sourceOwner.query(`INSERT INTO public.marketplace_sync_states
      (id, tenant_id, marketplace_account_id, next_offset, imported_count, pagination_restart_count)
      VALUES ($1, $2, $3, $4, $5, $6)`, ['restored-checkpoint', 'restore-tenant-b', 'restore-account-b', 50, 7, 1]);

    const archive = join(directory, 'database.pgdump');
    await writeFile(archive, await docker('ACL-free custom pg_dump', [
      'exec', source.name, 'pg_dump', '-U', 'postgres', '-d', databaseName, '--format=custom', '--no-owner', '--no-acl',
    ]), { mode: 0o600, flag: 'wx' });
    const targetOwner = await connect(target);
    // Roles are cluster objects and are deliberately absent from pg_dump.
    await targetOwner.query('CREATE ROLE farmaecon_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT');
    await docker('ACL-free pg_restore into fresh cluster', [
      'exec', '-i', target.name, 'pg_restore', '-U', 'postgres', '-d', databaseName, '--exit-on-error', '--no-owner', '--no-privileges',
    ], { input: await readFile(archive) });
    assert.deepEqual(await history(targetOwner), sourceHistory, 'Restore must preserve the complete Prisma migration history');
    assert.deepEqual(await privileges(targetOwner, 'public.marketplace_sync_states'), { select: false, insert: false, update: false, delete: false }, 'ACL-free restore must reproduce the missing checkpoint privileges');
    assert.equal(await publicLookupAllowed(targetOwner), true, 'ACL-free restore must reproduce default PUBLIC function execution');
    t.diagnostic('Reproduced: complete migration history, missing checkpoint ACLs, and restored PUBLIC function execution.');

    const outsiderPassword = secret();
    // Values are generated locally with a quote-free grammar and never placed in process arguments.
    await targetOwner.query(`CREATE ROLE restore_grants_outsider LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${outsiderPassword}'`);
    const outsider = await connect(target, 'restore_grants_outsider', outsiderPassword);
    assert.equal((await outsider.query('SELECT * FROM public.farmaecon_login_lookup($1)', ['absent@restore.test'])).rowCount, 0, 'An unprivileged login can call the restored PUBLIC function before repair');

    for (let pass = 1; pass <= 2; pass++) {
      await migrate(target, runtimePassword);
      assert.deepEqual(await history(targetOwner), sourceHistory, `Repair pass ${pass} must leave the already-complete migration history unchanged`);
      assert.deepEqual(await privileges(targetOwner, 'public.marketplace_sync_states'), { select: true, insert: true, update: true, delete: false });
      assert.equal(await publicLookupAllowed(targetOwner), false, 'Repair must revoke PUBLIC function execution');
    }
    await denied(() => outsider.query('SELECT * FROM public.farmaecon_login_lookup($1)', ['absent@restore.test']), 'A fresh unprivileged role must lose access to the login lookup after repair');

    // This is a separate TCP login, never SET ROLE on a privileged connection.
    const runtime = await connect(target, 'farmaecon_runtime', runtimePassword);
    const identity = (await runtime.query(`SELECT current_user, session_user, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relowner = r.oid) AS owns_public_relation
      FROM pg_roles r WHERE r.rolname = current_user`)).rows[0];
    assert.deepEqual(identity, { current_user: 'farmaecon_runtime', session_user: 'farmaecon_runtime', rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, owns_public_relation: false });
    assert.equal((await runtime.query('SELECT * FROM public.marketplace_sync_states')).rowCount, 0, 'Restored RLS must deny reads without a tenant context');
    await denied(() => runtime.query('SELECT * FROM public._prisma_migrations'), 'Runtime must not read Prisma migration internals');
    await denied(() => runtime.query('DELETE FROM public.marketplace_sync_states'), 'Runtime must never delete checkpoints');
    assert.equal((await runtime.query('SELECT * FROM public.farmaecon_login_lookup($1)', ['absent@restore.test'])).rowCount, 0, 'Runtime must retain the intended login lookup access');
    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", ['restore-tenant-a']);
      assert.equal((await runtime.query('SELECT * FROM public.marketplace_sync_states')).rowCount, 0, 'The other tenant checkpoint must remain hidden');
      await runtime.query(`INSERT INTO public.marketplace_sync_states (id, tenant_id, marketplace_account_id, next_offset, imported_count)
        VALUES ($1, $2, $3, $4, $5)`, ['runtime-checkpoint', 'restore-tenant-a', 'restore-account-a', 50, 3]);
      assert.equal((await runtime.query(`UPDATE public.marketplace_sync_states SET next_offset = $1,
        imported_count = $2, completed_pages = $3, pagination_restart_count = $4 WHERE id = $5`, [100, 6, 2, 1, 'runtime-checkpoint'])).rowCount, 1);
      assert.deepEqual((await runtime.query(`SELECT id, tenant_id, next_offset, imported_count, completed_pages, pagination_restart_count
        FROM public.marketplace_sync_states`)).rows, [{ id: 'runtime-checkpoint', tenant_id: 'restore-tenant-a', next_offset: 100, imported_count: 6, completed_pages: 2, pagination_restart_count: 1 }]);
      assert.equal((await runtime.query('UPDATE public.marketplace_sync_states SET next_offset = $1 WHERE id = $2', [999, 'restored-checkpoint'])).rowCount, 0, 'Runtime cannot update a foreign tenant checkpoint');
      await runtime.query('COMMIT');
    } catch (error) { await runtime.query('ROLLBACK'); throw error; }
    assert.equal((await runtime.query('SELECT * FROM public.marketplace_sync_states')).rowCount, 0, 'Transaction-local tenant context must not leak');
    assert.deepEqual((await targetOwner.query(`SELECT id, next_offset, imported_count, pagination_restart_count
      FROM public.marketplace_sync_states ORDER BY id`)).rows, [
      { id: 'restored-checkpoint', next_offset: 50, imported_count: 7, pagination_restart_count: 1 },
      { id: 'runtime-checkpoint', next_offset: 100, imported_count: 6, pagination_restart_count: 1 },
    ], 'Restored data and committed runtime writes must both survive');
    t.diagnostic('Two no-pending-migration repairs succeeded; authenticated runtime SELECT/INSERT/UPDATE, RLS isolation, and denied DELETE/Prisma/PUBLIC access verified.');

    // Future models must be discovered from dbName/name without widening grants to unsafe tables.
    await targetOwner.query(`CREATE TABLE public.restore_probe_mapped (tenant_id text, value integer);
      CREATE TABLE public."RestoreProbe" (tenant_id text, value integer);
      ALTER TABLE public.restore_probe_mapped ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON public.restore_probe_mapped TO farmaecon_runtime
        USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
        WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
      REVOKE SELECT ON public.tenants FROM farmaecon_runtime;`);
    const models = [...Prisma.dmmf.datamodel.models, { name: 'FutureMapped', dbName: 'restore_probe_mapped' }, { name: 'RestoreProbe', dbName: null }];
    async function rejectsUnsafeModel(reason) {
      await assert.rejects(() => targetOwner.query(runtimeGrantsSql(models)), reason);
      await targetOwner.query('ROLLBACK'); // Also recover if an implementation uses an explicit transaction.
      assert.equal((await privileges(targetOwner, 'public.tenants')).select, false, 'Unsafe model must abort every proposed grant');
      assert.deepEqual(await privileges(targetOwner, 'public.restore_probe_mapped'), { select: false, insert: false, update: false, delete: false }, 'No earlier model may receive partial grants');
    }
    await rejectsUnsafeModel('A future model without RLS must reject grant reconciliation');
    await targetOwner.query('ALTER TABLE public."RestoreProbe" ENABLE ROW LEVEL SECURITY');
    await rejectsUnsafeModel('A future model without a tenant policy must reject grant reconciliation');
    await targetOwner.query(`CREATE POLICY tenant_isolation ON public."RestoreProbe" TO farmaecon_runtime
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
      ALTER TABLE public."RestoreProbe" OWNER TO farmaecon_runtime;`);
    await rejectsUnsafeModel('A runtime-owned model must reject grant reconciliation');
    await targetOwner.query('ALTER TABLE public."RestoreProbe" OWNER TO postgres');
    await targetOwner.query(runtimeGrantsSql(models));
    for (const table of ['public.restore_probe_mapped', 'public."RestoreProbe"']) {
      assert.deepEqual(await privileges(targetOwner, table), { select: true, insert: true, update: true, delete: true }, 'Validated future models must receive CRUD grants using their physical table name');
    }
    assert.equal((await privileges(targetOwner, 'public.tenants')).select, true);
    assert.deepEqual(await privileges(targetOwner, 'public._prisma_migrations'), { select: false, insert: false, update: false, delete: false });
    assert.equal(await publicLookupAllowed(targetOwner), false);
    t.diagnostic('Dynamic mapped/unmapped models verified; missing RLS, missing policy, and runtime ownership abort all grants.');
  } catch (error) { failures.push(new Error(sanitize(error.message))); }
  finally {
    for (const result of await Promise.allSettled([...clients].map(client => client.end()))) {
      if (result.status === 'rejected') failures.push(new Error(`Test connection cleanup failed: ${sanitize(result.reason.message)}`));
    }
    for (const container of containers.reverse()) {
      try { await docker('remove owned disposable test container', ['rm', '--force', container], { timeout: 15_000 }); }
      catch (error) { failures.push(new Error(sanitize(error.message))); }
    }
    try { await rm(directory, { recursive: true, force: true }); }
    catch (error) { failures.push(new Error(`Test directory cleanup failed: ${sanitize(error.message)}`)); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Restore grant regression or disposable-resource cleanup failed');
});
