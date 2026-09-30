import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, open, unlink } from 'node:fs/promises';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';

const magic = Buffer.from('FARMAECON-BACKUP-1\n');
const headerSize = magic.length + 12;
function backupKey(encoded) {
  const key = Buffer.from(encoded ?? '', 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('A 32-byte base64 BACKUP_ENCRYPTION_KEY is required');
  return key;
}
export async function encryptBackup(input, destination, encodedKey) {
  const key = backupKey(encodedKey);
  const nonce = randomBytes(12);
  const header = Buffer.concat([magic, nonce]);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(header);
  const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  await once(output, 'open'); // Do not remove a pre-existing destination on failure.
  try {
    output.write(header);
    await pipeline(input, cipher, output);
    await appendFile(destination, cipher.getAuthTag());
  } catch {
    output.destroy();
    await unlink(destination).catch(() => {});
    throw new Error('Backup encryption failed; incomplete output removed');
  }
}
export async function decryptBackup(source, destination, encodedKey) {
  const key = backupKey(encodedKey);
  const file = await open(source, 'r');
  let header, tag, size;
  try {
    size = (await file.stat()).size;
    if (size <= headerSize + 16) throw new Error('Invalid backup');
    header = Buffer.alloc(headerSize); tag = Buffer.alloc(16);
    await file.read(header, 0, header.length, 0);
    await file.read(tag, 0, tag.length, size - tag.length);
    if (!header.subarray(0, magic.length).equals(magic)) throw new Error('Unsupported backup format');
  } finally { await file.close(); }
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(magic.length));
  decipher.setAAD(header); decipher.setAuthTag(tag);
  const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  await once(output, 'open');
  try {
    await pipeline(createReadStream(source, { start: headerSize, end: size - 17 }), decipher, output);
  } catch {
    output.destroy();
    await unlink(destination).catch(() => {});
    throw new Error('Backup authentication failed; plaintext removed');
  }
}
