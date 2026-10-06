# Farmaecon validation checkpoints

## 2026-09-19: resumed validation (stage 1 in progress)

Authorization: local validation, Docker validation, deployment to Hostinger VPS
1975247, app/api subdomain DNS and read-only Mercado Livre OAuth. Each stage
requires passing evidence before the next stage. No VPS recreation, removal of
existing services or volumes, or marketplace commercial writes.

Existing package.json change and untracked files were preserved. Existing local
secrets and backups must remain private and untouched.

- Baseline: API Jest suite passed, 4 suites / 29 tests.
- Baseline: API and frontend TypeScript checks passed.
- Root build failed: turbo executable missing from installed dependencies.
  Restoring dependencies from package-lock.json before retrying.
- Docker executable exists under Docker.app; /usr/local/bin/docker is a broken
  symlink to /Volumes/Docker. Desktop startup currently reports lingering
  processes and the engine is not yet reachable.
- PostgreSQL security integration, frontend browser flows, standalone output,
  container migration/persistence, backup restoration: not yet verified.
- Hostinger tools are not exposed in this session. VPS state has not been
  revalidated. No deployment or DNS changes have been made.
- No real Mercado Livre authorization or synchronization has occurred.

## Local validation evidence (stage 1 still incomplete)

- Restored 1193 packages with `npm ci --ignore-scripts --no-audit --no-fund`;
  package-lock.json unchanged. Regenerated Prisma Client 7.7.0.
- Added seven import-integrity regression cases; all seven failed against the
  original implementation. Fixed missing/invalid dates, invalid/missing amounts,
  empty identifiers and corrected timestamps. Invalid input no longer silently
  becomes today's date or zero and is validated before constructing writes.
- `npm test --workspace=api -- --runInBand`: 5 suites, 36 tests passed.
- Frontend proxy suite: 5 tests passed (missing/expired session, valid session,
  HttpOnly cookie rotation and request forwarding, rejected refresh).
- `npm run typecheck`: passed after new tests and changes.
- API and web individual builds passed. Web generated all 12 pages.
- Actual standalone server verified at
  `apps/web/.next/standalone/apps/web/server.js`. Preserved that start command;
  added prestart asset copying required by Next standalone output.
- Unified build exposed missing packageManager metadata. Added npm@11.11.0
  matching the installed npm. `npm run build` then passed: 2 successful tasks
  (API and web), 0 cached, 1m33.902s.
- Added `npm run test:postgres`: creates its own randomly named local database,
  migrates it, runs E2E tests and deletes only that owned test database.
  Existing local observation configuration is preserved.
- Real PostgreSQL test attempt failed before setup with
  `ECONNREFUSED 127.0.0.1:54329`; no integration pass is claimed.
- Docker startup/restart attempted through the installed Desktop CLI. Engine
  requests returned HTTP 500; logs showed the backend could not reach the VM
  at 192.168.65.7:2376. No reset, pruning or volume removal was performed.
- New PostgreSQL test source is typechecked, but its database assertions remain
  unexecuted. Browser login/report and container validation remain pending.
- Started standalone on loopback port 3300. HTTP verification:
  `http://127.0.0.1:3300/login` returned 200; all 12 referenced JS/CSS assets
  returned 200; `/observation` without credentials returned 307 to `/login`.
  This checks HTTP delivery only, not authenticated browser interaction.
- Stopped the failed Docker Desktop instance with the official force-stop
  command; no data or volume deletion. Engine repair remains necessary.
- `git diff --check` and Node syntax checks for both new scripts passed.

Status: stage 1 partially verified, NOT complete. Stages 2-5 NOT started.
No VPS publication, DNS edits, account connection or commercial write occurred.

Resume: restore a working local Docker engine, launch only the observation
project dependencies, run `npm run test:postgres`, then finish authenticated
browser validation. Do not proceed to VPS/DNS/OAuth until all stage gates pass.

## Stage gates

1. Local: unit + real PostgreSQL security tests, frontend session lifecycle,
   observation policy, typecheck, builds and actual standalone path.
2. Docker: isolated PostgreSQL/Redis/application, empty and upgrade migrations,
   health/readiness, browser login/report, restart persistence, artifact IDs.
3. VPS: connector state, existing Traefik inspection, isolated service setup,
   secrets, backup and tested isolated restore, then validated artifacts only.
4. DNS: read current A/AAAA/CNAME/proxy, change only app/api, verify HTTPS.
5. Mercado Livre: official OAuth/PKCE documentation, browser authorization,
   read-only sample reconciliation, dates/values/pagination/sync provenance.
