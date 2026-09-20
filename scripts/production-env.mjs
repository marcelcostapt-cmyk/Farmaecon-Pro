import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const random = () => randomBytes(32).toString('base64url');
const key = () => randomBytes(32).toString('base64');
const domain = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const image = /^(?:[a-z0-9][a-z0-9./:_-]*:[a-zA-Z0-9_][a-zA-Z0-9_.-]*|[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64})$/;

export function productionDefaults() {
  return {
    DB_USER: 'farmaecon', DB_PASSWORD: random(), DB_NAME: 'farmaecon_db',
    JWT_ACCESS_SECRET: random(), JWT_REFRESH_SECRET: random(),
    TOKEN_ENCRYPTION_KEY: key(), BACKUP_ENCRYPTION_KEY: key(),
    OWNER_EMAIL: '', OWNER_PASSWORD: random(), OWNER_NAME: 'Administrador', COMPANY_NAME: 'Farmaecon',
    API_IMAGE: '', WEB_IMAGE: '',
    APP_DOMAIN: 'app.farmaecon.com.br', API_DOMAIN: 'api.farmaecon.com.br',
    TRAEFIK_NETWORK: '', TRAEFIK_CERT_RESOLVER: '',
    MARKETPLACE_SOURCE: 'MOCK', ML_PKCE_ENABLED: 'false', ML_APP_ID: '', ML_SECRET_KEY: '',
  };
}

export function initializeProduction(file = '.local/production.env') {
  if (existsSync(file)) return false;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  chmodSync(dirname(file), 0o700);
  writeFileSync(file, Object.entries(productionDefaults()).map(([k,v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  return true;
}

export function validateProduction(env, { traefik = false } = {}) {
  const fail = field => { throw new Error(`Invalid or missing production setting: ${field}`); };
  for (const field of ['DB_USER', 'DB_NAME']) if (!/^[a-z][a-z0-9_]{0,62}$/.test(env[field] ?? '')) fail(field);
  // Base64url avoids ambiguous URL characters in the assembled DATABASE_URL.
  if (!/^[A-Za-z0-9_-]{32,}$/.test(env.DB_PASSWORD ?? '')) fail('DB_PASSWORD');
  for (const field of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) if ((env[field] ?? '').length < 32) fail(field);
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) fail('JWT_REFRESH_SECRET');
  for (const field of ['TOKEN_ENCRYPTION_KEY', 'BACKUP_ENCRYPTION_KEY']) {
    const decoded = Buffer.from(env[field] ?? '', 'base64');
    if (decoded.length !== 32 || decoded.toString('base64') !== env[field]) fail(field);
  }
  if (env.TOKEN_ENCRYPTION_KEY === env.BACKUP_ENCRYPTION_KEY) fail('BACKUP_ENCRYPTION_KEY');
  for (const field of ['APP_DOMAIN', 'API_DOMAIN']) if (!domain.test(env[field] ?? '')) fail(field);
  if (env.APP_DOMAIN === env.API_DOMAIN) fail('API_DOMAIN');
  for (const field of ['API_IMAGE', 'WEB_IMAGE']) if (!image.test(env[field] ?? '') || /:latest$/.test(env[field])) fail(field);
  if (!['MOCK', 'MERCADO_LIVRE'].includes(env.MARKETPLACE_SOURCE)) fail('MARKETPLACE_SOURCE');
  if (env.MARKETPLACE_SOURCE === 'MERCADO_LIVRE') {
    if (!/^\d+$/.test(env.ML_APP_ID ?? '')) fail('ML_APP_ID');
    if (!env.ML_SECRET_KEY) fail('ML_SECRET_KEY');
    if (env.ML_PKCE_ENABLED !== 'true') fail('ML_PKCE_ENABLED');
  }
  if (traefik) for (const field of ['TRAEFIK_NETWORK', 'TRAEFIK_CERT_RESOLVER']) if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(env[field] ?? '')) fail(field);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.includes('--check')) {
      validateProduction(process.env, { traefik: process.argv.includes('--traefik') });
      console.log('PASS: production configuration. No secret values printed.');
    } else {
      console.log(initializeProduction() ? 'Created .local/production.env (0600). Set tested image references and verified Traefik settings before deployment.' : 'Existing production configuration preserved; no secrets rotated.');
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
