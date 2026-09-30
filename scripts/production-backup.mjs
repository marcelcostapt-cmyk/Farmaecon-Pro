import { spawn, spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { encryptBackup, decryptBackup } from './backup-crypto.mjs';

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
  const result = spawnSync(docker, args, { encoding: 'utf8', env, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) throw new Error('Docker backup/restore command failed; inspect the named operation locally');
  return result.stdout.trim();
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
  let container;
  try {
    // Authenticate the entire archive before passing any SQL to Postgres.
    await decryptBackup(resolve(source), archive, process.env.BACKUP_ENCRYPTION_KEY);
    const name = `farmaecon-restore-${randomUUID()}`;
    container = run(['run', '-d', '--name', name, '--network', 'none', '--memory', '1g', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=restore_check', 'postgres:15-alpine'], { ...process.env, POSTGRES_PASSWORD: randomBytes(32).toString('base64url') });
    if (!/^[a-f0-9]{64}$/.test(container)) { container = undefined; throw new Error('Unexpected restore container identifier'); }
    let ready = false;
    for (let attempt = 0; attempt < 45; attempt++) {
      const status = spawnSync(docker, ['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'restore_check'], { stdio: 'ignore', timeout: 3000 });
      if (status.status === 0) { ready = true; break; }
      await delay(1000);
    }
    if (!ready) throw new Error('Isolated restore database did not become ready');
    // pg_dump contains policies, but cluster roles are deliberately not dumped.
    run(['exec', container, 'psql', '-U', 'postgres', '-d', 'restore_check', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE ROLE farmaecon_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;']);
    const child = spawn(docker, ['exec', '-i', container, 'pg_restore', '-U', 'postgres', '-d', 'restore_check', '--exit-on-error', '--no-owner', '--no-privileges'], { stdio: ['pipe', 'ignore', 'ignore'] });
    const exit = completed(child);
    await Promise.all([pipeline(createReadStream(archive), child.stdin), exit]);
    const migrations = run(['exec', container, 'psql', '-U', 'postgres', '-d', 'restore_check', '-At', '-c', 'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL']);
    if (!/^\d+$/.test(migrations) || Number(migrations) < 1) throw new Error('Restored database lacks completed migrations');
    run(['exec', container, 'psql', '-U', 'postgres', '-d', 'restore_check', '-At', '-c', 'SELECT count(*) FROM public.tenants; SELECT count(*) FROM public.orders; SELECT count(*) FROM public.auth_sessions;']);
    const protectedTables = run(['exec', container, 'psql', '-U', 'postgres', '-d', 'restore_check', '-At', '-c', "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity"]);
    if (Number(protectedTables) !== 8) throw new Error('Restored row-security policies are incomplete');
    console.log('PASS: authenticated archive restored in a disposable Postgres container with no network. Production database untouched.');
  } finally {
    try { if (container) run(['rm', '-f', container]); }
    finally { await rm(temporary, { recursive: true, force: true }); }
  }
}
try {
  if (process.argv[2] === 'backup') await backup();
  else if (process.argv[2] === 'verify-restore') await verifyRestore(process.argv[3]);
  else throw new Error('Use backup or verify-restore <encrypted-file>');
} catch (error) { console.error(error.message); process.exitCode = 1; }
