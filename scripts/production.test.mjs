import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { productionDefaults, initializeProduction, validateProduction } from './production-env.mjs';
import { encryptBackup, decryptBackup } from './backup-crypto.mjs';
import { auditStage, captureProcess, OUTPUT_TAIL_CHARS, runCommand, withCleanup } from './production-diagnostics.mjs';
import { collectRestoreDiagnostics, waitForRestoreDatabase } from './production-backup.mjs';

const fixture = () => ({ ...productionDefaults(), API_IMAGE: 'farmaecon-api:tested-commit', WEB_IMAGE: 'farmaecon-web:tested-commit', TRAEFIK_NETWORK: 'proxy', TRAEFIK_CERT_RESOLVER: 'acme' });
test('new production secrets are independent and external marketplace access starts disabled', () => {
  const a = fixture(), b = fixture();
  assert.equal(validateProduction(a, { traefik: true }), true);
  assert.equal(a.MARKETPLACE_SOURCE, 'MOCK');
  assert.equal(a.ML_SECRET_KEY, '');
  for (const field of ['DB_PASSWORD', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'TOKEN_ENCRYPTION_KEY', 'BACKUP_ENCRYPTION_KEY']) assert.notEqual(a[field], b[field]);
});
test('initialization preserves existing credentials and restricts newly created files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'farmaecon-init-'));
  try {
    const file = join(directory, 'secrets', 'production.env');
    assert.equal(initializeProduction(file), true);
    const before = readFileSync(file);
    assert.equal(initializeProduction(file), false);
    assert.deepEqual(readFileSync(file), before);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(directory, 'secrets')).mode & 0o777, 0o700);
  } finally { rmSync(directory, { recursive: true }); }
});
test('preflight rejects missing keys, unsafe URLs, mutable latest images and incomplete real OAuth', () => {
  for (const change of [
    { DB_PASSWORD: 'short' }, { DB_PASSWORD: 'x'.repeat(32) + '@' },
    { JWT_ACCESS_SECRET: '' }, { TOKEN_ENCRYPTION_KEY: 'bad-key' },
    { APP_DOMAIN: 'https://app.farmaecon.com.br/path' }, { DB_USER: 'bad:user' },
    { API_IMAGE: 'farmaecon-api:latest' }, { WEB_IMAGE: '' },
    { MARKETPLACE_SOURCE: 'LIVE' }, { MARKETPLACE_SOURCE: 'MERCADO_LIVRE' },
  ]) assert.throws(() => validateProduction({ ...fixture(), ...change }));
  const a = fixture();
  assert.throws(() => validateProduction({ ...a, JWT_REFRESH_SECRET: a.JWT_ACCESS_SECRET }));
  assert.throws(() => validateProduction({ ...a, BACKUP_ENCRYPTION_KEY: a.TOKEN_ENCRYPTION_KEY }));
  assert.throws(() => validateProduction({ ...a, TRAEFIK_NETWORK: '' }, { traefik: true }));
  assert.equal(validateProduction({ ...a, API_IMAGE: 'ghcr.io/org/api@sha256:' + 'a'.repeat(64) }), true);
});
test('production example does not contain a configured credential', () => {
  const text = readFileSync(new URL('../.env.prod.example', import.meta.url), 'utf8');
  for (const name of ['DB_PASSWORD', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'TOKEN_ENCRYPTION_KEY', 'BACKUP_ENCRYPTION_KEY', 'ML_SECRET_KEY', 'OWNER_PASSWORD']) assert.match(text, new RegExp(`^${name}=$`, 'm'));
});
test('backup roundtrip, tamper rejection and protection against overwrites', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'farmaecon-backup-'));
  const key = randomBytes(32).toString('base64');
  const bytes = Buffer.concat([Buffer.from('PGDMP'), randomBytes(128 * 1024)]);
  const encrypted = join(directory, 'dump.enc'), plain = join(directory, 'dump.pg');
  try {
    await encryptBackup(Readable.from(bytes), encrypted, key);
    assert.equal(statSync(encrypted).mode & 0o777, 0o600);
    await decryptBackup(encrypted, plain, key);
    assert.deepEqual(readFileSync(plain), bytes);
    assert.equal(statSync(plain).mode & 0o777, 0o600);
    await assert.rejects(encryptBackup(Readable.from(bytes), encrypted, key));
    await assert.rejects(decryptBackup(encrypted, plain, key));
    assert.deepEqual(readFileSync(plain), bytes);
    rmSync(plain);
    await assert.rejects(decryptBackup(encrypted, plain, randomBytes(32).toString('base64')));
    assert.equal(existsSync(plain), false);
    const damaged = readFileSync(encrypted); damaged[40] ^= 1; writeFileSync(encrypted, damaged);
    await assert.rejects(decryptBackup(encrypted, plain, key));
    assert.equal(existsSync(plain), false);
  } finally { rmSync(directory, { recursive: true }); }
});

test('failed child logs command, arguments, status, signal and bounded output before throwing', () => {
  const logs = [];
  const stdout = 'discarded-start:' + 'o'.repeat(5000) + ':stdout-end';
  const stderr = 'discarded-start:' + 'e'.repeat(5000) + ':pg_restore: database is starting';
  assert.throws(() => runCommand('docker', ['exec', 'isolated', 'pg_restore'], {
    env: {}, logger: line => logs.push(line),
    execute: () => ({ status: 7, signal: 'SIGTERM', stdout, stderr }),
  }), error => {
    assert.equal(logs.length, 1, 'Diagnostic must be emitted before the exception');
    const record = JSON.parse(logs[0]);
    assert.equal(record.command, 'docker');
    assert.deepEqual(record.args, ['exec', 'isolated', 'pg_restore']);
    assert.equal(record.status, 7);
    assert.equal(record.signal, 'SIGTERM');
    assert.equal(record.spawnError, null);
    assert.equal(record.stdout, stdout.slice(-OUTPUT_TAIL_CHARS));
    assert.equal(record.stderr, stderr.slice(-OUTPUT_TAIL_CHARS));
    assert(!Number.isNaN(Date.parse(record.startedAt)));
    assert(!Number.isNaN(Date.parse(record.timestamp)));
    for (const text of ['docker', 'pg_restore', '"status":7', 'SIGTERM', 'database is starting']) assert(error.message.includes(text));
    assert(!error.message.includes('discarded-start:'));
    return true;
  });
});

test('known sensitive environment values are redacted from commands, output and spawn errors', () => {
  const env = { DB_PASSWORD: 'fake-db/pw+only', ENCRYPTION_KEY: 'fake-key-"quoted"-only' };
  const secrets = Object.values(env).flatMap(value => [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]);
  const logs = [];
  const diagnostic = secrets.join(' | ');
  assert.throws(() => runCommand('docker', ['--example', diagnostic], {
    env, logger: line => logs.push(line),
    execute: () => ({ status: null, signal: null, stdout: diagnostic, stderr: diagnostic,
      error: Object.assign(new Error(`spawn failed: ${diagnostic}`), { code: 'ENOENT' }) }),
  }), error => {
    const record = JSON.parse(logs[0]);
    assert.equal(record.spawnError.code, 'ENOENT');
    assert.equal(record.status, null);
    const output = logs.join('\n') + error.message + JSON.stringify(record);
    for (const secret of secrets) assert(!output.includes(secret), 'A sensitive value leaked');
    assert.match(output, /\[REDACTED\]/);
    assert.match(error.message, /spawn failed/);
    return true;
  });
});

test('redaction happens before truncation and successful CI commands also log diagnostics', () => {
  const env = { DB_PASSWORD: 'fake-sensitive-password-tail' }, logs = [];
  const result = runCommand('docker', ['ps'], {
    env, logger: line => logs.push(line),
    execute: () => ({ status: 0, signal: null, stdout: env.DB_PASSWORD + 'x'.repeat(3995), stderr: '' }),
  });
  assert.equal(result.status, 0);
  const record = JSON.parse(logs[0]);
  assert.equal(record.stdout.length, OUTPUT_TAIL_CHARS);
  assert(!record.stdout.includes('password-tail'));
  assert.equal(record.stderr, '');
});

test('DATABASE_URL and REDIS_URL are masked when embedded in longer command and error strings', () => {
  const env = { DATABASE_URL: 'postgres://user:pass@host/db', REDIS_URL: 'redis://default:fake-redis-pass@cache:6379/0' };
  const command = `running: psql ${env.DATABASE_URL}; redis-cli -u ${env.REDIS_URL}`;
  const expected = 'running: psql [REDACTED]; redis-cli -u [REDACTED]';
  const logs = [];
  assert.throws(() => runCommand('sh', ['-c', command], {
    env, logger: line => logs.push(line),
    execute: () => ({ status: 1, stdout: command, stderr: `failed: ${command}` }),
  }), error => {
    const record = JSON.parse(logs[0]);
    assert.equal(record.args[1], expected);
    assert.equal(record.stdout, expected);
    assert.equal(record.stderr, `failed: ${expected}`);
    const combined = logs.join('\n') + error.message;
    for (const value of [...Object.values(env), 'user:pass@', 'fake-redis-pass']) assert(!combined.includes(value));
    assert(error.message.includes(expected));
    return true;
  });
});

test('CI preserves early structured restore evidence outside the output tail and sanitizes it again', () => {
  const env = { DB_PASSWORD: 'fake-audit-password' }, logs = [];
  const event = { event: 'restore.stage.start', stage: 'container.create', timestamp: '2026-10-07T00:00:00.000Z', diagnostic: env.DB_PASSWORD };
  runCommand('node', ['scripts/production-backup.mjs', 'verify-restore'], {
    env, forwardEvents: true, logger: line => logs.push(line),
    execute: () => ({ status: 0, stdout: JSON.stringify(event) + '\n' + 'x'.repeat(5000), stderr: '' }),
  });
  assert.equal(logs.length, 2);
  assert.deepEqual(JSON.parse(logs[0]), { ...event, diagnostic: '[REDACTED]' });
  assert.equal(JSON.parse(logs[1]).stdout.length, OUTPUT_TAIL_CHARS);
  assert(!logs.join('\n').includes(env.DB_PASSWORD));
});

test('streamed pg_restore failure retains stderr and redacts secrets split across chunks', async () => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
  const env = { ENCRYPTION_KEY: 'fake-stream-secret-only' }, logs = [];
  const exit = captureProcess(child, 'docker', ['exec', 'isolated', 'pg_restore'], { env, logger: line => logs.push(line) });
  child.stdout.write('o'.repeat(6000));
  child.stderr.write('discarded:' + 'e'.repeat(6000) + 'pg_restore: missing role; ' + env.ENCRYPTION_KEY.slice(0, 8));
  child.stderr.end(env.ENCRYPTION_KEY.slice(8));
  child.stdout.end();
  child.emit('close', 1, null);
  await assert.rejects(exit, error => {
    assert.match(error.message, /pg_restore: missing role/);
    assert(!error.message.includes(env.ENCRYPTION_KEY));
    assert(!error.message.includes('discarded:'));
    const record = JSON.parse(logs[0]);
    assert.equal(record.status, 1);
    assert.equal(record.stderr.length, OUTPUT_TAIL_CHARS);
    assert.match(record.stderr, /\[REDACTED\]/);
    return true;
  });
});

test('successful restore child stays silent and asynchronous spawn errors retain their cause', async () => {
  const logs = [];
  const success = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
  const done = captureProcess(success, 'docker', ['exec'], { env: {}, logger: line => logs.push(line) });
  success.stdout.end('normal output'); success.stderr.end('notice'); success.emit('close', 0, null);
  await done;
  assert.deepEqual(logs, []);
  const failed = new EventEmitter();
  const exit = captureProcess(failed, 'docker', ['exec'], { env: {}, logger: line => logs.push(line) });
  failed.emit('error', Object.assign(new Error('executable unavailable'), { code: 'ENOENT' }));
  failed.emit('close', -2, null);
  await assert.rejects(exit, /executable unavailable/);
  assert.equal(JSON.parse(logs[0]).spawnError.code, 'ENOENT');
});

test('readiness retries TCP and requires SELECT 1 in restore_check before succeeding', async () => {
  const calls = [], sleeps = [], logs = [];
  const responses = [
    { status: 2, stdout: '', stderr: 'no TCP listener' },
    { status: 0, stdout: 'accepting connections', stderr: '' },
    { status: 2, stdout: '', stderr: 'database restore_check does not exist' },
    { status: 0, stdout: 'accepting connections', stderr: '' },
    { status: 0, stdout: '1\n', stderr: '' },
  ];
  const env = { POSTGRES_PASSWORD: 'fake-temporary-db-password' };
  await waitForRestoreDatabase('isolated-container', {
    env, attempts: 3, sleep: async ms => sleeps.push(ms), logger: line => logs.push(line),
    execute: (command, args, options) => { calls.push({ command, args, options }); return responses.shift(); },
  });
  assert.equal(responses.length, 0);
  assert.deepEqual(sleeps, [1000, 1000]);
  assert.equal(calls.length, 5, 'Do not query until TCP responds');
  for (const { args } of calls) {
    assert.deepEqual(args.slice(0, 2), ['exec', 'isolated-container']);
    const command = args.join(' ');
    assert.match(command, /-h 127\.0\.0\.1 -p 5432/);
    assert.match(command, /-d restore_check/);
    assert(!command.includes(env.POSTGRES_PASSWORD));
    if (args[2] === 'sh') assert.match(command, /SELECT 1/);
  }
  const attempts = logs.map(JSON.parse).filter(log => log.event === 'postgres.readiness.attempt');
  assert.deepEqual(attempts.map(log => [log.tcpReady, log.databaseReady]), [[false, false], [true, false], [true, true]]);
  assert.equal(JSON.parse(logs.at(-1)).status, 'success');
});

test('readiness never accepts TCP alone or an unexpected query result and stops after its retry budget', async () => {
  const sleeps = [], logs = [];
  await assert.rejects(waitForRestoreDatabase('isolated', {
    env: {}, attempts: 2, intervalMs: 7, sleep: async ms => sleeps.push(ms), logger: line => logs.push(line),
    execute: (_command, args) => ({ status: 0, stdout: args.includes('pg_isready') ? 'accepting' : '0', stderr: '' }),
  }), /after 2 attempts.*TCP and restore_check SELECT 1 required/);
  assert.deepEqual(sleeps, [7]);
  assert.equal(JSON.parse(logs.at(-1)).status, 'failure');
});

test('stage timestamps and both operation/cleanup errors survive without exposing secrets', async () => {
  const env = { DB_PASSWORD: 'fake-cleanup-password' }, logs = [], events = [];
  const options = { env, logger: line => logs.push(line) };
  await assert.rejects(withCleanup(
    () => auditStage('pg_restore', async () => { events.push('restore'); throw new Error(`original restore failure ${env.DB_PASSWORD}`); }, options),
    async () => { events.push('cleanup'); throw new Error(`cleanup failure ${env.DB_PASSWORD}`); }, options,
  ), error => {
    assert(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.match(error.errors[0].message, /original restore failure/);
    assert.match(error.errors[1].message, /cleanup failure/);
    assert.match(error.message, /original restore failure.*cleanup failure/);
    assert(!error.message.includes(env.DB_PASSWORD));
    return true;
  });
  assert.deepEqual(events, ['restore', 'cleanup']);
  assert(!logs.join('\n').includes(env.DB_PASSWORD));
  const records = logs.map(JSON.parse);
  assert.deepEqual(records.map(record => record.event), ['restore.stage.start', 'restore.stage.end', 'operation.failure', 'cleanup.failure']);
  for (const record of records) assert(!Number.isNaN(Date.parse(record.timestamp)));
  assert.equal(records[1].status, 'failure');
  assert(records[1].durationMs >= 0);
});

test('failure evidence is collected before cleanup and tolerates an unavailable diagnostic tool', async () => {
  const env = { DB_PASSWORD: 'fake-diagnostics-password' }, logs = [], commands = [];
  const options = { env, logger: line => logs.push(line) };
  await assert.rejects(withCleanup(async () => {
    collectRestoreDiagnostics('isolated', { ...options, execute: (command, args) => {
      commands.push([command, args]);
      if (command === 'free') return { error: Object.assign(new Error('free missing'), { code: 'ENOENT' }), status: null };
      return { status: 0, stdout: `evidence ${env.DB_PASSWORD}`, stderr: '' };
    } });
    throw new Error('restore failed');
  }, async () => commands.push(['cleanup', []]), options), /restore failed/);
  assert.deepEqual(commands.map(([command, args]) => [command, args[0]]), [
    ['docker', 'logs'], ['docker', 'inspect'], ['df', '-h'], ['free', '-m'], ['cleanup', undefined],
  ]);
  assert.deepEqual(commands[0][1], ['logs', '--tail', '80', '--timestamps', 'isolated']);
  assert.deepEqual(commands[1][1], ['inspect', '--format', '{{json .State}}', 'isolated']);
  assert(!logs.join('\n').includes(env.DB_PASSWORD));
  assert(logs.some(line => line.includes('free missing')));
});

test('verify-restore CLI with a Docker stub preserves restore/cleanup errors and removes its temporary directory', async () => {
  // Exercises the real Node process/pipe wiring. No Docker or PostgreSQL is run.
  const directory = mkdtempSync(join(tmpdir(), 'farmaecon-restore-cli-test-'));
  const executable = join(directory, 'docker-stub.mjs'), callsFile = join(directory, 'calls.jsonl');
  const archive = join(directory, 'backup.enc'), key = randomBytes(32).toString('base64');
  try {
    await encryptBackup(Readable.from(Buffer.from('PGDMP fixture')), archive, key);
    writeFileSync(executable, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.TEST_CALLS_FILE, JSON.stringify(args) + '\\n');
if (args[0] === 'run') console.log('a'.repeat(64));
else if (args.includes('pg_isready')) console.log('accepting');
else if (args.includes('SELECT 1') || args.some(arg => arg.includes('SELECT 1'))) console.log('1');
else if (args.includes('pg_restore')) {
  for await (const chunk of process.stdin) { /* consume the test archive */ }
  process.stderr.write('pg_restore: simulated failure; password=' + process.env.POSTGRES_PASSWORD + '; key=' + process.env.BACKUP_ENCRYPTION_KEY);
  process.exitCode = 42;
} else if (args[0] === 'logs') console.log('container evidence before removal');
else if (args[0] === 'inspect') console.log(JSON.stringify({ OOMKilled: false, ExitCode: 42, Status: 'running' }));
else if (args[0] === 'rm') { console.error('simulated cleanup failure'); process.exitCode = 9; }
`, { mode: 0o700 });
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./production-backup.mjs', import.meta.url)), 'verify-restore', archive], {
      encoding: 'utf8', timeout: 15000,
      env: { ...process.env, TMPDIR: directory, FARMAECON_DOCKER_BIN: executable, BACKUP_ENCRYPTION_KEY: key, TEST_CALLS_FILE: callsFile },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    const output = result.stdout + result.stderr;
    assert(!output.includes(key));
    const events = output.split('\n').filter(Boolean).map(line => JSON.parse(line));
    const restore = events.find(event => event.event === 'process.end' && event.args.includes('pg_restore'));
    assert.equal(restore.status, 42);
    assert.equal(restore.stderr, 'pg_restore: simulated failure; password=[REDACTED]; key=[REDACTED]');
    const final = events.find(event => event.event === 'backup.failure');
    assert.match(final.error, /pg_restore: simulated failure/);
    assert.match(final.error, /simulated cleanup failure/);
    const calls = readFileSync(callsFile, 'utf8').trim().split('\n').map(JSON.parse);
    const removal = calls.findIndex(args => args[0] === 'rm');
    for (const command of ['logs', 'inspect']) assert(calls.findIndex(args => args[0] === command) < removal);
    const creation = calls.find(args => args[0] === 'run');
    assert.equal(creation[creation.indexOf('--network') + 1], 'none');
    assert(!creation.includes('-p') && !creation.includes('--publish'));
    assert(!readdirSync(directory).some(name => name.startsWith('farmaecon-restore-')), 'Directory cleanup must run even when container cleanup fails');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
