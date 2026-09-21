import { spawnSync } from 'node:child_process';
import pg from 'pg';

// Executed by the migration container only. Runtime never receives this URL.
const password = process.env.RUNTIME_DB_PASSWORD;
if (!process.env.DATABASE_URL) throw new Error('Private migration connection required');
if (!/^[A-Za-z0-9_-]{32,}$/.test(password ?? '')) throw new Error('Protected runtime database password required');
const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--config', 'apps/api/prisma.config.ts'], {
    env: process.env, encoding: 'utf8', timeout: 120000,
  });
  if (result.status !== 0) throw new Error('Database migrations failed');
  await database.connect();
  const role = (await database.query("SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname='farmaecon_runtime'")).rows[0];
  if (!role || role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole) throw new Error('Unsafe runtime database role');
  // PostgreSQL does not parameterize ALTER ROLE. The strict base64url grammar
  // above excludes quotes and SQL syntax. Never log this statement or the error.
  await database.query(`ALTER ROLE farmaecon_runtime LOGIN PASSWORD '${password}'`);
  await database.query('GRANT USAGE ON SCHEMA public TO farmaecon_runtime');
  await database.query('GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, users, marketplace_accounts, orders, products, financial_transactions, auth_sessions, oauth_states TO farmaecon_runtime');
  await database.query('GRANT EXECUTE ON FUNCTION public.farmaecon_login_lookup(text) TO farmaecon_runtime');
  console.log('PASS: migrations applied and restricted runtime role configured. No credentials printed.');
} catch {
  console.error('Migration/runtime-role preparation failed. Review the isolated database without printing environment values.');
  process.exitCode = 1;
} finally { await database.end(); }
