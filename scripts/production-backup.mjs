import { spawn, spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { encryptBackup, decryptBackup } from './backup-crypto.mjs';
import { auditStage, captureProcess, logEvent, runCommand, withCleanup } from './production-diagnostics.mjs';

// Run on the host that owns Docker. No SSH, marketplace or Hostinger API calls.
const docker = process.env.FARMAECON_DOCKER_BIN || 'docker';
const environmentFile = process.env.FARMAECON_PRODUCTION_ENV || '.local/production.env';
const project = process.env.FARMAECON_COMPOSE_PROJECT || 'farmaecon';
const compose = ['compose', '--env-file', environmentFile, '-p', project, '-f', 'docker-compose.prod.yml'];
function completed(child) {
  const result = new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('Docker command unavailable')));
    child.once('close', code => code === 0 ? resolve() : reject(new Error('Docker backup/restore command failed')));
  });
  result.catch(() => {}); // Attach before streaming so failures cannot go unhandled.
  return result;
}
function run(args, env = process.env) {
  const result = runCommand(docker, args, { env, timeout: 120000, logSuccess: false });
  return result.stdout.trim();
}

export async function waitForRestoreDatabase(container, {
  env = process.env, execute = spawnSync, sleep = delay, logger = console.log,
  attempts = 30, intervalMs = 1000,
} = {}) {
  return auditStage('postgres.readiness', async () => {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const options = { env, execute, logger, timeout: 3000, allowFailure: true, logSuccess: false };
      const tcp = runCommand(docker, ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-d', 'restore_check'], options);
      let query;
      if (tcp.status === 0) {
        // Read the password inside the container; never put its value in argv.
        query = runCommand(docker, ['exec', container, 'sh', '-c', 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -h 127.0.0.1 -p 5432 -U postgres -d restore_check -v ON_ERROR_STOP=1 -At -c "SELECT 1"'], options);
      }
      const ready = tcp.status === 0 && query?.status === 0 && query.stdout.trim() === '1';
      logEvent({ event: 'postgres.readiness.attempt', attempt, tcpReady: tcp.status === 0, databaseReady: ready }, { env, logger });
      if (ready) return;
      if (attempt < attempts) await sleep(intervalMs);
    }
    throw new Error(`Isolated restore database did not become ready after ${attempts} attempts (TCP and restore_check SELECT 1 required)`);
  }, { env, logger });
}

export function collectRestoreDiagnostics(container, { env = process.env, execute = spawnSync, logger = console.log } = {}) {
  const commands = [
    ...(container ? [
      [docker, ['logs', '--tail', '80', '--timestamps', container]],
      // Inspect only State (includes OOMKilled/ExitCode/Error), never Config.Env.
      [docker, ['inspect', '--format', '{{json .State}}', container]],
    ] : []),
    ['df', ['-h']], ['free', ['-m']],
  ];
  for (const [command, args] of commands) {
    try { runCommand(command, args, { env, execute, logger, timeout: 5000, allowFailure: true }); }
    catch { /* Spawn failures were logged; keep collecting other evidence. */ }
  }
}
async function backup() {
  const directory = resolve(process.env.FARMAECON_BACKUP_DIR || '.local/backups');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = join(directory, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.pgdump.enc`);
  const child = spawn(docker, [...compose, 'exec', '-T', 'db', 'sh', '-c', 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const exit = completed(child);
  try {
    await encryptBackup(child.stdout, destination, process.env.BACKUP_ENCRYPTION_KEY);
    await exit;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(destination)) hash.update(chunk);
    await writeFile(destination + '.sha256', hash.digest('hex') + '\n', { mode: 0o600, flag: 'wx' });
    console.log(`Encrypted backup created: ${destination}`);
    console.log('Store an off-host copy and keep the encryption key separately. Restore is not verified until verify-restore passes.');
  } catch (error) {
    child.kill(); await unlink(destination).catch(() => {}); throw error;
  }
}
async function verifyRestore(source) {
  if (!source) throw new Error('Provide the encrypted backup path');
  const temporary = await mkdtemp(join(tmpdir(), 'farmaecon-restore-'));
  const archive = join(temporary, 'database.pgdump');
  const env = { ...process.env, POSTGRES_PASSWORD: randomBytes(32).toString('base64url') };
  const stage = (name, operation) => auditStage(name, operation, { env });
  const restoreRun = args => run(args, env);
  let container;
  await withCleanup(async () => {
    try {
      // Authenticate the entire archive before passing any SQL to Postgres.
      await stage('archive.decrypt', () => decryptBackup(resolve(source), archive, process.env.BACKUP_ENCRYPTION_KEY));
      const name = `farmaecon-restore-${randomUUID()}`;
      // POSTGRES_DB still creates the database in the image entrypoint. This
      // stage ends only once that database answers SELECT 1 over TCP.
      await stage('restore_check.initialize', async () => {
        await stage('container.create', () => {
          // Retain the UUID name for diagnostics/cleanup even if docker run fails.
          container = name;
          const id = restoreRun(['run', '-d', '--name', name, '--network', 'none', '--memory', '1g', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=restore_check', 'postgres:15-alpine']);
          if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Unexpected restore container identifier');
          container = id;
        });
        await waitForRestoreDatabase(container, { env });
      });
      // pg_dump contains policies, but cluster roles are deliberately not dumped.
      await stage('runtime-role.create', () => restoreRun(['exec', container, 'psql', '-U', 'postgres', '-d', 'restore_check', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE ROLE farmaecon_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;']));
      await stage('pg_restore', async () => {
        const args = ['exec', '-i', container, 'pg_restore', '-U', 'postgres', '-d', 'restore_check', '--exit-on-error', '--no-owner', '--no-privileges'];
        const child = spawn(docker, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
        const exit = captureProcess(child, docker, args, { env });
        const [input, processExit] = await Promise.allSettled([pipeline(createReadStream(archive), child.stdin), exit]);
        // Prefer the PostgreSQL diagnostic over an EPIPE caused by its exit.
        if (processExit.status === 'rejected') throw processExit.reason;
        if (input.status === 'rejected') throw input.reason;
      });
      await stage('restore.verify', () => {
        const migrations = restoreRun(['exec', container, 'psql', '-U', 'postgres', '-d', 'restore_check', '-At', '-c', 'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL']);
        if (!/^\d+$/.test(migrations) || Number(migrations) < 1) throw new Error('Restored database lacks completed migrations');
        restoreRun(['exec', container, 'psql', '-U', 'postgres', '-d', 'restore_check', '-At', '-c', 'SELECT count(*) FROM public.tenants; SELECT count(*) FROM public.orders; SELECT count(*) FROM public.auth_sessions;']);
        const protectedTables = restoreRun(['exec', container, 'psql', '-U', 'postgres', '-d', 'restore_check', '-At', '-c', "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity"]);
        const expectedProtectedTables = restoreRun(['exec', container, 'psql', '-U', 'postgres', '-d', 'restore_check', '-At', '-c', "SELECT CASE WHEN to_regclass('public.marketplace_sync_states') IS NULL THEN 8 ELSE 9 END"]);
        if (Number(protectedTables) !== Number(expectedProtectedTables)) throw new Error('Restored row-security policies are incomplete');
      });
      console.log('PASS: authenticated archive restored in a disposable Postgres container with no network. Production database untouched.');
    } catch (error) {
      collectRestoreDiagnostics(container, { env });
      throw error;
    }
  }, () => withCleanup(
    () => stage('container.cleanup', () => { if (container) restoreRun(['rm', '-f', container]); }),
    () => stage('directory.cleanup', () => rm(temporary, { recursive: true, force: true })),
    { env },
  ), { env });
}
// Keep CLI behaviour while allowing the probes to be tested without Docker.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'backup') await backup();
    else if (process.argv[2] === 'verify-restore') await verifyRestore(process.argv[3]);
    else throw new Error('Use backup or verify-restore <encrypted-file>');
  } catch (error) { logEvent({ event: 'backup.failure', error: error.message }, { logger: console.error }); process.exitCode = 1; }
}
