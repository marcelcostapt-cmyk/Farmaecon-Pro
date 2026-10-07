import { chmodSync, lstatSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
// Add only the new application database key, preserving every existing secret.
const file = process.argv[2];
if (!file) throw new Error('Provide the existing protected environment file path');
const info = lstatSync(file);
if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077)) throw new Error('Owner-only regular environment file required');
const content = readFileSync(file, 'utf8');
if (/^RUNTIME_DB_PASSWORD=.+$/m.test(content)) {
  console.log('Existing runtime key preserved.');
} else {
  const value = randomBytes(32).toString('base64url');
  const updated = content.replace(/^RUNTIME_DB_PASSWORD=.*\n?/gm, '').trimEnd() + `\nRUNTIME_DB_PASSWORD=${value}\n`;
  const temporary = `${file}.temporary-${randomUUID()}`;
  writeFileSync(temporary, updated, { mode: 0o600, flag: 'wx' });
  chmodSync(temporary, 0o600); renameSync(temporary, file);
  console.log('New runtime database key saved privately. Existing keys preserved.');
}
