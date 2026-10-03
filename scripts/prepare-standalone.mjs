import { access, cp } from 'node:fs/promises';

const web = new URL('../apps/web/', import.meta.url);
const standalone = new URL('.next/standalone/apps/web/', web);
await access(new URL('server.js', standalone));
await cp(new URL('public/', web), new URL('public/', standalone), { recursive: true });
await cp(new URL('.next/static/', web), new URL('.next/static/', standalone), { recursive: true });
console.log('Standalone static assets prepared.');
