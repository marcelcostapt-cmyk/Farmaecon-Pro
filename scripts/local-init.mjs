import { mkdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const file = '.local/observation.env';
if (existsSync(file)) { console.log('Local configuration already exists; preserved.'); process.exit(0); }
mkdirSync('.local', { recursive: true, mode: 0o700 }); chmodSync('.local', 0o700);
const random = () => randomBytes(32).toString('base64url');
const db = random();
const env = {
  LOCAL_SIMULATION: 'true', MARKETPLACE_MODE: 'OBSERVATION', MARKETPLACE_SOURCE: 'MOCK',
  LOCAL_DB_PASSWORD: db, DATABASE_URL: `postgresql://farmaecon:${db}@127.0.0.1:54329/farmaecon_observation`,
  REDIS_HOST: '127.0.0.1', REDIS_PORT: '63799', PORT: '3001', FRONTEND_URL: 'http://localhost:3000',
  JWT_ACCESS_SECRET: random(), JWT_REFRESH_SECRET: random(), TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  DEMO_ADMIN_A_PASSWORD: random(), DEMO_OPERATOR_A_PASSWORD: random(), DEMO_ADMIN_B_PASSWORD: random(),
};
writeFileSync(file, Object.entries(env).map(([k,v]) => `${k}=${v}`).join('\n')+'\n', { mode: 0o600, flag: 'wx' });
console.log('Local-only secrets generated in .local/observation.env (0600). No marketplace credentials configured.');
