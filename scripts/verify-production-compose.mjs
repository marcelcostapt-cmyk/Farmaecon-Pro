import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { productionDefaults } from './production-env.mjs';

// Config-only verification: never contacts the Docker daemon or an account.
const env = { ...process.env, ...productionDefaults(), API_IMAGE: 'farmaecon-api:ci', WEB_IMAGE: 'farmaecon-web:ci', TRAEFIK_NETWORK: 'verified-proxy', TRAEFIK_CERT_RESOLVER: 'verified-acme' };
const executable = process.env.FARMAECON_COMPOSE_BIN || 'docker';
const prefix = process.env.FARMAECON_COMPOSE_BIN ? [] : ['compose'];
const args = [...prefix, '--env-file', '/dev/null', '-p', 'farmaecon-config-check', '-f', 'docker-compose.prod.yml'];
function config(extra = [], source = env) {
  const result = spawnSync(executable, [...args, ...extra, 'config', '--format', 'json'], { env: source, encoding: 'utf8' });
  if (result.error) throw new Error('Docker Compose is required for configuration validation');
  return result;
}
for (const extra of [[], ['-f', 'docker-compose.vps.yml']]) {
  const result = config(extra);
  assert.equal(result.status, 0, 'Production Compose must resolve successfully');
  const model = JSON.parse(result.stdout);
  const { db, redis, migrate, api, web } = model.services;
  assert(db && redis && migrate && api && web);
  for (const service of Object.values(model.services)) assert(!service.ports?.length, 'Production services must not publish host ports');
  for (const service of [db, redis]) assert.deepEqual(Object.keys(service.networks), ['farmaecon-internal']);
  assert.equal(model.networks['farmaecon-internal'].internal, true);
  assert(!web.networks['farmaecon-internal'], 'Frontend must not have direct database access');
  assert.equal(migrate.image, api.image, 'Migration must use the same API artifact');
  assert.deepEqual(migrate.command, ['node', 'scripts/database-migrate.mjs']);
  assert(new URL(api.environment.DATABASE_URL).username === 'farmaecon_runtime', 'API must use the restricted role');
  assert(api.environment.DATABASE_URL !== migrate.environment.DATABASE_URL, 'Migration and runtime identities must differ');
  assert.equal(api.depends_on.migrate.condition, 'service_completed_successfully');
  assert.equal(api.depends_on.redis.condition, 'service_healthy');
  assert.equal(web.depends_on.api.condition, 'service_healthy');
  assert.equal(api.environment.JWT_ACCESS_SECRET, env.JWT_ACCESS_SECRET);
  assert.equal(api.environment.JWT_REFRESH_SECRET, env.JWT_REFRESH_SECRET);
  assert.equal(api.environment.TOKEN_ENCRYPTION_KEY, env.TOKEN_ENCRYPTION_KEY);
  assert(!api.environment.JWT_SECRET && !api.environment.BACKUP_ENCRYPTION_KEY);
  assert.equal(api.environment.MARKETPLACE_MODE, 'OBSERVATION');
  assert.equal(api.environment.MARKETPLACE_SOURCE, 'MOCK');
  assert.equal(web.environment.API_INTERNAL_URL, 'http://api:3001/api/v1');
  assert.equal(web.environment.LOCAL_SIMULATION, 'false');
  assert.equal(api.environment.ML_REDIRECT_URI, `https://${env.APP_DOMAIN}/auth/callback`);
  for (const service of [api, web]) assert.equal(service.build.context, process.cwd(), 'Docker build context must be the monorepo root');
  if (extra.length) {
    assert.equal(model.networks.web.external, true);
    assert.equal(model.networks.web.name, env.TRAEFIK_NETWORK);
    assert.equal(web.labels['traefik.docker.network'], env.TRAEFIK_NETWORK);
    assert.equal(api.labels['traefik.http.routers.farmaecon-api.rule'], `Host(\`${env.API_DOMAIN}\`)`);
  }
}
for (const field of ['DB_PASSWORD', 'RUNTIME_DB_PASSWORD', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'TOKEN_ENCRYPTION_KEY', 'API_IMAGE', 'WEB_IMAGE']) {
  assert.notEqual(config([], { ...env, [field]: '' }).status, 0, `${field} must fail closed`);
}
console.log('PASS: production and VPS Compose, private data services, required keys, artifact parity, migrations, internal API routing and observation defaults.');
