import { verifyBrowser } from './browser-check.mjs';
if (process.env.LOCAL_SIMULATION !== 'true' || process.env.MARKETPLACE_SOURCE !== 'MOCK') throw new Error('Isolated local simulation required');
await verifyBrowser({
  baseURL: 'http://localhost:3000', apiBase: 'http://127.0.0.1:3001/api/v1',
  accounts: ['a', 'b'].map(key => ({
    email: `admin-${key}@observation.local`, password: process.env[`DEMO_ADMIN_${key.toUpperCase()}_PASSWORD`],
    sourceName: `Conta simulada ${key.toUpperCase()}`, foreignSourceName: `Conta simulada ${key === 'a' ? 'B' : 'A'}`,
  })),
});
