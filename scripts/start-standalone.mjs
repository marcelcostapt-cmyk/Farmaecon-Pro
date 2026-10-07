import { existsSync, cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

// Verified against the monorepo output emitted by the installed Next.js build.
const server = resolve('apps/web/.next/standalone/apps/web/server.js');
if (!existsSync(server)) throw new Error('Standalone build missing. Run npm run build first.');
const target = dirname(server);
mkdirSync(resolve(target, '.next'), { recursive: true });
for (const [source, destination] of [['apps/web/public', 'public'], ['apps/web/.next/static', '.next/static']]) {
  if (!existsSync(source)) throw new Error(`Required build assets missing: ${source}`);
  cpSync(source, resolve(target, destination), { recursive: true });
}
const child = spawn(process.execPath, [server], {
  stdio: 'inherit', env: { ...process.env, HOSTNAME: process.env.FARMAECON_WEB_HOST ?? '127.0.0.1', PORT: process.env.PORT ?? '3000' },
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('Standalone server could not start'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
