import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
@Injectable()
export class TokenVault {
  private readonly key: Buffer;
  constructor(config: ConfigService) {
    const encoded = config.getOrThrow<string>('TOKEN_ENCRYPTION_KEY');
    this.key = Buffer.from(encoded, 'base64');
    if (this.key.length !== 32 || this.key.toString('base64') !== encoded) throw new Error('TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  encrypt(value: string, context: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
  }
  decrypt(value: string, context: string) {
    try {
      const [version, iv, tag, data, extra] = value.split('.');
      if (version !== 'v1' || !iv || !tag || !data || extra) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch { throw new Error('Encrypted credential unavailable; reconnect the account'); }
  }
}
