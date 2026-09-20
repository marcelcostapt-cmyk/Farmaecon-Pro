import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { productionDefaults, initializeProduction, validateProduction } from './production-env.mjs';
import { encryptBackup, decryptBackup } from './backup-crypto.mjs';

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
