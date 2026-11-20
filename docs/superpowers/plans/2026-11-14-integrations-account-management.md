# Gestão de contas ML em `/integrations` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir renomear, desconectar, reconectar (mesmo seller), conectar e remover contas Mercado Livre em `/integrations`, com cards claros e feedback de ações.

**Architecture:** Migration aditiva (Prisma 7) + novos métodos em `IntegrationsService`/`MlOAuthService` e rotas em `IntegrationsController` (NestJS). Na web, a página continua server component; cada card é um componente cliente que chama route handlers Next (JSON) que reencaminham à API com o cookie httpOnly `access_token`.

**Tech Stack:** NestJS 10, Prisma 7 (PostgreSQL, RLS por tenant), BullMQ, class-validator, Jest; Next.js 14 App Router, Tailwind, `components/ui` (card, badge, button).

**Spec:** `docs/superpowers/specs/2026-11-14-integrations-account-management-design.md`

## Global Constraints

- ORM só Prisma 7; migrations em `apps/api/prisma/migrations/<nome>/migration.sql`, só aditivas.
- Estado da conta = `status` (`ACTIVE` / `WARNING` / `DISCONNECTED`); não criar `isConnected`.
- Desconectar apaga `accessToken`, `refreshToken`, `expiresAt` (null) e põe `status = DISCONNECTED`.
- `name` continua `ML #<sellerId>`; UI mostra `displayName ?? name`; `displayName` vazio/espaços → `null`; máx. 60 caracteres.
- Reconectar exige `String(tokens.user_id) === account.externalSellerId`; caso contrário 409 `SELLER_MISMATCH`, sem escrita.
- Remover = hard delete só com `status = DISCONNECTED`, 0 pedidos e 0 jobs pendentes (`marketplace-sync` e `token-refresh`).
- Rename/disconnect/reconnect/delete/callback com `AdminGuard`; `sync` aberto a qualquer utilizador do tenant.
- Toda a query de conta filtra por `tenantId`; tokens só via `TokenVault`.
- Sem Server Actions novas, sem dependências npm novas, sem token no JS do browser.
- Erros 409 da API: `throw new ConflictException({ code, message })` com as mensagens de `account-errors.ts` (Task 2).
- Sem deploy em produção nem alteração de env de produção. Commits locais; push só com OK do utilizador.

## Review Focus

1. Nome com só espaços, com 61+ caracteres, ou com emoji — espaços → `null`; >60 (contando code points) → 400; emoji aceite. *(Task 2)*
2. Duplo clique / dois pedidos de desconectar — o segundo é no-op sem erro. *(Task 3)*
3. Remover ou renomear conta de **outro tenant** — 404, nunca 409 (não revelar existência nem estado). *(Tasks 2 e 5)*
4. Conta apagada entre "Reconectar" e o callback — callback falha, nenhuma conta é criada. *(Task 4)*
5. Redis em baixo ao listar — `GET /integrations` responde com `nextSyncAt: null` em vez de 500. *(Task 6)*

---

## File Structure

**API (`apps/api`)**
- `prisma/schema.prisma` — `displayName` em `MarketplaceAccount`, `expectedAccountId` em `OAuthState`.
- `prisma/migrations/20261114_integrations_account_management/migration.sql` — novo.
- `src/shared/security/public-selects.ts` — `displayName` em `publicAccountSelect`.
- `src/modules/integrations/account-errors.ts` — novo: códigos e mensagens PT dos 409.
- `src/modules/integrations/account-jobs.ts` — novo: `findPendingAccountJobs`.
- `src/modules/integrations/integrations.service.ts` — `rename`, `disconnect` (+token-refresh), `startReconnect`, `remove`, `findAll` (+`nextSyncAt`).
- `src/modules/integrations/ml-oauth.service.ts` — `oauthConfig`, `buildAuthorizationUrl(actor, expectedAccountId?)`, validação de seller em `exchangeCode`.
- `src/modules/integrations/marketplace-sync.scheduler.ts` — `nextRunAt`.
- `src/modules/integrations/integrations.controller.ts` — rotas novas + DTO.
- `test/memory-prisma.ts` — `deleteMany`.
- Testes: `src/modules/integrations/account-management.spec.ts` (novo), `security.spec.ts` (reconnect), `marketplace-sync.scheduler.spec.ts` (nextRunAt).

**Web (`apps/web/src/app`)**
- `api/integrations/proxy.ts` — novo: helper partilhado dos route handlers JSON.
- `api/integrations/[id]/route.ts` — novo: `PATCH`, `DELETE`.
- `api/integrations/[id]/disconnect/route.ts`, `api/integrations/[id]/reconnect/route.ts` — novos.
- `api/integrations/[id]/sync/route.ts` — aceitar `fetch` JSON mantendo form/redirect.
- `auth/callback/route.ts` — `seller_mismatch` / `ml_reconnected`.
- `(dashboard)/integrations/types.ts` — novo: `Account`, `OAuthConfig`.
- `(dashboard)/integrations/account-card.tsx` — novo (cliente).
- `(dashboard)/integrations/connect-card.tsx` — novo.
- `(dashboard)/integrations/page.tsx`, `callback-handler.tsx` — modificar.

---

### Task 1: Migration e schema

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (models `MarketplaceAccount`, `OAuthState`)
- Create: `apps/api/prisma/migrations/20261114_integrations_account_management/migration.sql`
- Modify: `apps/api/src/shared/security/public-selects.ts:3-5`
- Modify: `apps/api/test/memory-prisma.ts` (método de modelo)

**Interfaces:**
- Produces: `MarketplaceAccount.displayName: string | null`, `OAuthState.expectedAccountId: string | null`; `publicAccountSelect` inclui `displayName`; `MemoryPrisma.<model>.deleteMany({ where }) → { count }`.

- [ ] **Step 1: Escrever a migration** (SQL fixo):

```sql
ALTER TABLE "marketplace_accounts" ADD COLUMN "display_name" TEXT;
ALTER TABLE "oauth_states" ADD COLUMN "expected_account_id" TEXT;
```

- [ ] **Step 2: Atualizar `schema.prisma`** — `displayName String? @map("display_name")` e `expectedAccountId String? @map("expected_account_id")`; acrescentar `displayName: true` a `publicAccountSelect`; acrescentar `deleteMany` ao `MemoryPrisma.model()` (remove as linhas que `matches` e devolve `{ count }`).

- [ ] **Step 3: Validar**

Run: `cd apps/api && npx prisma validate --config prisma.config.ts && npx prisma generate --config prisma.config.ts && cd ../.. && npm run typecheck && (cd apps/api && npx jest --silent)`
Expected: schema válido; typecheck sem erros; `Tests: 113 passed`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma apps/api/src/shared/security/public-selects.ts apps/api/test/memory-prisma.ts
git commit -m "feat(db): displayName em contas e expected_account_id no state OAuth"
```

---

### Task 2: Renomear conta (`PATCH /integrations/:id`)

**Files:**
- Create: `apps/api/src/modules/integrations/account-errors.ts`
- Modify: `apps/api/src/modules/integrations/integrations.service.ts`, `integrations.controller.ts`
- Test: `apps/api/src/modules/integrations/account-management.spec.ts` (novo)

**Interfaces:**
- Produces: `AccountErrors` (abaixo); `IntegrationsService.rename(tenantId: string, accountId: string, displayName: string | null): Promise<PublicAccount>`; DTO `RenameAccountDto { displayName: string | null }`.

`account-errors.ts` (cópia fixa):

```ts
export const AccountErrors = {
  SELLER_MISMATCH: 'A conta Mercado Livre autenticada não corresponde a esta integração. Entre com a conta original e tente novamente.',
  RECONNECT_NOT_ALLOWED: 'Só é possível reconectar contas desconectadas.',
  ACCOUNT_NOT_DISCONNECTED: 'Desconecte a conta antes de a remover.',
  ACCOUNT_HAS_ORDERS: 'Não é possível remover esta conta porque possui histórico de pedidos. Desconecte-a para parar a sincronização.',
  ACCOUNT_HAS_PENDING_JOBS: 'Há sincronizações pendentes para esta conta. Aguarde que terminem e tente novamente.',
} as const;
export type AccountErrorCode = keyof typeof AccountErrors;
export const accountConflict = (code: AccountErrorCode) => new ConflictException({ code, message: AccountErrors[code] });
```

- [ ] **Step 1: Testes que falham** em `account-management.spec.ts` (`describe('IntegrationsService.rename')`, com `MemoryPrisma` e uma conta `{ id:'acc-a', tenantId:'a', status:'ACTIVE', name:'ML #1', externalSellerId:'1' }`):
  - `'trims and stores the display name'` → `rename('a','acc-a','  Farmashop ')` grava `'Farmashop'`.
  - `'stores null for blank names'` → `rename('a','acc-a','   ')` e `rename('a','acc-a',null)` gravam `null`.
  - `'rejects names longer than 60 characters'` → `'x'.repeat(61)` lança `BadRequestException`; `'😀'.repeat(60)` é aceite.
  - `'returns 404 for an account of another tenant'` → `rename('b','acc-a','X')` lança `NotFoundException` e a linha fica intacta.

- [ ] **Step 2: Correr e ver falhar**

Run: `cd apps/api && npx jest account-management -t rename`
Expected: FAIL (`rename is not a function`).

- [ ] **Step 3: Implementar** `rename` (trim; `''` → null; `[...value].length > 60` → `BadRequestException`; `updateMany({ where:{ id, tenantId }, data:{ displayName } })`, `count === 0` → `NotFoundException`; devolve `findFirst` com `publicAccountSelect`) e no controller `@UseGuards(AdminGuard) @Patch(':id')` com `RenameAccountDto` (`@IsOptional() @IsString() @MaxLength(240)` — o limite de 60 vive no serviço) e `ok(...)`.

- [ ] **Step 4: Correr e ver passar**

Run: `cd apps/api && npx jest account-management -t rename`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit** — `git commit -m "feat(integrations): renomear conta com displayName"`

---

### Task 3: Desconectar também limpa refresh de token

**Files:**
- Create: `apps/api/src/modules/integrations/account-jobs.ts`
- Modify: `apps/api/src/modules/integrations/integrations.service.ts` (construtor + `disconnect`)
- Test: `account-management.spec.ts`, `marketplace-sync.scheduler.spec.ts:155+` (atualizar construtor)

**Interfaces:**
- Produces: `PENDING_JOB_STATES = ['active','waiting','delayed','prioritized','waiting-children'] as const`; `findPendingAccountJobs(queue: Queue, accountId: string): Promise<Job[]>` (filtra `job.data?.accountId === accountId`); `IntegrationsService` recebe `@InjectQueue(QUEUE_TOKEN_REFRESH) tokenQueue: Queue` como 3.º argumento do construtor (antes de `ordersSync`).

- [ ] **Step 1: Testes que falham** (`describe('IntegrationsService.disconnect')`):
  - `'clears tokens, marks DISCONNECTED and removes schedule and token refresh jobs'` → após `disconnect('a','acc-a')`: `accessToken/refreshToken/expiresAt === null`, `status === 'DISCONNECTED'`, `scheduler.removeRecurring` chamado com `'acc-a'`, `remove()` chamado no job delayed de token-refresh com `data.accountId === 'acc-a'` e **não** no job de `'acc-b'`.
  - `'is a no-op the second time'` → duas chamadas seguidas resolvem sem erro.
  - `'returns 404 for another tenant'` → `disconnect('b','acc-a')` lança `NotFoundException`.

- [ ] **Step 2: Correr e ver falhar** — `npx jest account-management -t disconnect` → FAIL.

- [ ] **Step 3: Implementar** `findPendingAccountJobs` e, em `disconnect`, trocar `findFirstOrThrow` por `findFirst` + `NotFoundException`, e depois do `updateMany` remover os jobs pendentes de `tokenQueue` (`job.remove()` num `try`, com `logger.warn` em falha). Atualizar o `setup` do teste existente em `marketplace-sync.scheduler.spec.ts` ao novo construtor.

- [ ] **Step 4: Correr e ver passar** — `npx jest account-management marketplace-sync.scheduler` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(integrations): desconectar remove refresh de token pendente"`

---

### Task 4: Reconectar com o mesmo seller

**Files:**
- Modify: `apps/api/src/modules/integrations/ml-oauth.service.ts`, `integrations.service.ts`, `integrations.controller.ts`
- Test: `apps/api/src/modules/integrations/security.spec.ts` (novo `describe('reconnect')`)

**Interfaces:**
- Consumes: `accountConflict` (Task 2), `OAuthState.expectedAccountId` (Task 1).
- Produces: `MlOAuthService.oauthConfig(): { oauthAvailable: boolean; reason: 'OK' | 'SIMULATED_SOURCE' | 'PKCE_DISABLED' | 'MISSING_CONFIG' }`; `buildAuthorizationUrl(actor: AuthPrincipal, expectedAccountId?: string): Promise<{ url: string }>`; `exchangeCode(...) : Promise<{ accountId: string; reconnected: boolean }>`; `IntegrationsService.startReconnect(actor: AuthPrincipal, accountId: string): Promise<{ url: string }>` (`IntegrationsService` recebe `MlOAuthService` por injeção); rota `POST /integrations/:id/reconnect` (Admin) → `ok({ url })`.

- [ ] **Step 1: Testes que falham** (reaproveitar o `beforeEach` existente; conta prévia `{ id:'acc-a', tenantId:'a', status:'DISCONNECTED', externalSellerId:'123', name:'ML #123', displayName:'Farmashop', accessToken:null, refreshToken:null }`):
  - `'reconnects the same account when the seller matches'` → `buildAuthorizationUrl(actor,'acc-a')` grava `expectedAccountId:'acc-a'`; `exchangeCode` (fixture `user_id:123`) devolve `{ accountId:'acc-a', reconnected:true }`; `db.rows.marketplaceAccount.length === 1`; `status === 'ACTIVE'`; `displayName === 'Farmashop'`; token decifra com `'a:123'`.
  - `'rejects a different seller without writing anything'` → fixture `user_id:999`; `exchangeCode` rejeita com `ConflictException` cujo `getResponse()` é `{ code:'SELLER_MISMATCH', message: AccountErrors.SELLER_MISMATCH }`; a conta continua `DISCONNECTED` com tokens `null`; 1 só conta; `queue.add` não chamado.
  - `'fails when the expected account was deleted before the callback'` → apagar `acc-a` depois de `buildAuthorizationUrl`; `exchangeCode` rejeita; `db.rows.marketplaceAccount.length === 0`.
  - `'new connect for an existing disconnected seller reactivates it and keeps displayName'` → sem `expectedAccountId`, `user_id:123` → mesma `id`, `ACTIVE`, `displayName` mantido.
  - `'startReconnect refuses accounts that are not DISCONNECTED'` → conta `ACTIVE` → `ConflictException` com `code:'RECONNECT_NOT_ALLOWED'`; outro tenant → `NotFoundException`.
  - `oauthConfig` → `MOCK` → `SIMULATED_SOURCE`; `ML_PKCE_ENABLED:'false'` → `PKCE_DISABLED`; sem `ML_APP_ID` → `MISSING_CONFIG`; config completa → `{ oauthAvailable:true, reason:'OK' }`.

- [ ] **Step 2: Correr e ver falhar** — `npx jest security -t reconnect` → FAIL.

- [ ] **Step 3: Implementar.** `oauthConfig` substitui as duas verificações no topo de `buildAuthorizationUrl` (que lança `BadRequestException` com a mesma mensagem atual quando `!oauthAvailable`). Em `exchangeCode`, depois de `tokenRequest`: se `stored.expectedAccountId`, carregar a conta por `{ id, tenantId: actor.tenantId }` (inexistente → `NotFoundException`), comparar seller (diferente → `accountConflict('SELLER_MISMATCH')`), e `updateMany` por `{ id, tenantId }` com credenciais + `status:'ACTIVE'`; senão o upsert atual. `startReconnect` valida a conta (`findFirst` por tenant; ≠ `DISCONNECTED` ou sem `externalSellerId` → `RECONNECT_NOT_ALLOWED`) e delega em `buildAuthorizationUrl(actor, accountId)`. Controller: rota `reconnect`; `callback` continua a chamar `scheduleInitialSync` e devolve `ok({ connected: true, reconnected })`.

- [ ] **Step 4: Correr e ver passar** — `npx jest security` → PASS (incluindo testes antigos de state/PKCE).

- [ ] **Step 5: Commit** — `git commit -m "feat(integrations): reconectar exige o mesmo seller ML"`

---

### Task 5: Remover conta desconectada (`DELETE /integrations/:id`)

**Files:**
- Modify: `integrations.service.ts`, `integrations.controller.ts`
- Test: `account-management.spec.ts`

**Interfaces:**
- Consumes: `findPendingAccountJobs` (Task 3), `accountConflict` (Task 2).
- Produces: `IntegrationsService.remove(tenantId: string, accountId: string): Promise<void>`; rota `@UseGuards(AdminGuard) @Delete(':id')` → `ok({ removed: true })`.

- [ ] **Step 1: Testes que falham** (`describe('IntegrationsService.remove')`):
  - `'deletes a disconnected account without orders or pending jobs'` → conta removida de `db.rows`, `scheduler.removeRecurring('acc-a')` chamado.
  - `'refuses ACTIVE accounts'` → `code:'ACCOUNT_NOT_DISCONNECTED'`.
  - `'refuses accounts with orders'` → 1 `order` com `marketplaceAccountId:'acc-a'` → `code:'ACCOUNT_HAS_ORDERS'`, `message === AccountErrors.ACCOUNT_HAS_ORDERS`; conta e pedido intactos.
  - `'refuses accounts with pending jobs in either queue'` → `it.each(['sync','token'])` com job `waiting` para `'acc-a'` → `code:'ACCOUNT_HAS_PENDING_JOBS'`.
  - `'returns 404 for another tenant even if it would conflict'` → conta `ACTIVE` do tenant `a`, `remove('b','acc-a')` → `NotFoundException`.

- [ ] **Step 2: Correr e ver falhar** — `npx jest account-management -t remove` → FAIL.

- [ ] **Step 3: Implementar** pela ordem: `findFirst({ id, tenantId })` → 404; status → 409; `order.count({ where:{ tenantId, marketplaceAccountId } })` → 409; pending jobs nas duas filas → 409; `scheduler.removeRecurring`; `deleteMany({ where:{ id, tenantId, status:'DISCONNECTED' } })`.

- [ ] **Step 4: Correr e ver passar** — `npx jest account-management` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(integrations): remover conta desconectada sem histórico"`

---

### Task 6: Listagem com próxima sync e estado OAuth

**Files:**
- Modify: `marketplace-sync.scheduler.ts`, `integrations.service.ts` (`findAll`), `integrations.controller.ts`
- Test: `marketplace-sync.scheduler.spec.ts`, `account-management.spec.ts`

**Interfaces:**
- Consumes: `MlOAuthService.oauthConfig` (Task 4).
- Produces: `MarketplaceSyncScheduler.nextRunAt(accountId: string): Promise<Date | null>` (via `queue.getJobScheduler(schedulerId(accountId))?.next`); cada item de `findAll` ganha `displayName` e `nextSyncAt: string | null` (ISO); rota `GET /integrations/ml/config` (jwt) → `ok(oauthConfig())`, declarada **antes** de qualquer rota `:id`.

- [ ] **Step 1: Testes que falham:**
  - scheduler: `'nextRunAt returns the next tick or null'` → `getJobScheduler` com `{ next: 1794684499835 }` → `new Date(1794684499835)`; `undefined` → `null`.
  - service: `'findAll includes displayName and nextSyncAt'`; `'findAll returns nextSyncAt null when Redis fails'` → `getJobScheduler` rejeita → resposta com `nextSyncAt: null`, sem lançar.

- [ ] **Step 2: Correr e ver falhar** — `npx jest -t "nextRunAt|findAll"` → FAIL.

- [ ] **Step 3: Implementar** `nextRunAt` (erros → `null` com `logger.warn`) e `findAll` com `Promise.all` sobre as contas.

- [ ] **Step 4: Correr tudo** — `cd apps/api && npx jest --silent` → todos PASS; `cd ../.. && npm run typecheck` → sem erros.

- [ ] **Step 5: Commit** — `git commit -m "feat(integrations): próxima sincronização e estado OAuth na listagem"`

---

### Task 7: Route handlers web e callback

**Files:**
- Create: `apps/web/src/app/api/integrations/proxy.ts`, `api/integrations/[id]/route.ts`, `api/integrations/[id]/disconnect/route.ts`, `api/integrations/[id]/reconnect/route.ts`
- Modify: `api/integrations/[id]/sync/route.ts`, `auth/callback/route.ts`, `(dashboard)/integrations/callback-handler.tsx`

**Interfaces:**
- Consumes: rotas API das Tasks 2–6.
- Produces: `proxyToApi(request: Request, method: 'POST'|'PATCH'|'DELETE', apiPath: string, body?: unknown): Promise<NextResponse>` → JSON `{ ok: true, data }` ou `{ ok: false, code?, message }` com o status da API; 403 se `Origin` ≠ `FRONTEND_URL ?? origin`; 401 `{ ok:false, message:'Sessão expirada' }` sem cookie. Rotas web: `PATCH|DELETE /api/integrations/[id]`, `POST /api/integrations/[id]/disconnect`, `POST /api/integrations/[id]/reconnect` (devolve `data.url`), `POST /api/integrations/[id]/sync` (JSON se `Accept` contém `application/json`, senão redirect atual).

- [ ] **Step 1: Implementar `proxy.ts`** reaproveitando a lógica de `API_URL`/cookie/`Origin` do `sync/route.ts`, e os três route handlers (cada um uma linha a chamar `proxyToApi` com o `id` de `params`).
- [ ] **Step 2: Callback** — em `auth/callback/route.ts`, ler o corpo da API: 409 com `code === 'SELLER_MISMATCH'` → `?error=seller_mismatch`; sucesso com `data.reconnected` → `?success=ml_reconnected`. Em `callback-handler.tsx`: `seller_mismatch` mostra `AccountErrors.SELLER_MISMATCH` (copiar o texto, a web não importa da API) e `ml_reconnected` mostra título "Conta reconectada!" / "A importação de pedidos foi retomada.".
- [ ] **Step 3: Verificar**

Run: `npm run typecheck && cd apps/web && npx eslint src/app/api/integrations src/app/auth/callback "src/app/(dashboard)/integrations"`
Expected: sem erros.

- [ ] **Step 4: Commit** — `git commit -m "feat(web): route handlers JSON para gerir contas ML"`

---

### Task 8: UI da página `/integrations`

**Files:**
- Create: `(dashboard)/integrations/types.ts`, `account-card.tsx`, `connect-card.tsx`
- Modify: `(dashboard)/integrations/page.tsx`

**Interfaces:**
- Consumes: route handlers da Task 7; `GET /integrations` e `GET /integrations/ml/config` via `fetchApi`; `getCurrentUser()` de `@/lib/auth` (`role`).
- Produces: `AccountCard({ account: Account; isAdmin: boolean })` (cliente); `ConnectCard({ config: OAuthConfig })`.

- [ ] **Step 1: `types.ts`** — mover `Account` de `page.tsx`, acrescentar `displayName: string | null`, `nextSyncAt: string | null`; `OAuthConfig = { oauthAvailable: boolean; reason: 'OK'|'SIMULATED_SOURCE'|'PKCE_DISABLED'|'MISSING_CONFIG' }`.
- [ ] **Step 2: `account-card.tsx`** conforme spec §6.3: nome inline (lápis; Enter/blur grava via `PATCH`, Esc cancela; nome técnico pequeno quando há `displayName`); badge `ACTIVE` "Ativa" verde, `WARNING` "Atenção" amarelo, `DISCONNECTED` "Desconectada" cinza, `syncStatus` `PARTIAL`/`RUNNING` → "Sincronizando…" azul; linha com pedidos, última e próxima sync (`toLocaleString('pt-BR')`); ações por estado (ativa: "Sincronizar agora" + "Desconectar"; desconectada: "Reconectar" + "Remover"; não-admin só "Sincronizar agora" e nome não editável); `window.confirm` antes de desconectar ("Desconectar esta conta? A sincronização para e os tokens são apagados.") e remover ("Remover esta conta da lista? Esta ação não pode ser desfeita."); um estado `pending` por ação, botões desativados durante o pedido; erro inline com a `message` da API; `router.refresh()` após sucesso; card desconectado com `opacity-60` e fundo neutro. Ícones em SVG inline.
- [ ] **Step 3: `connect-card.tsx`** — `oauthAvailable` → link `/api/integrations/ml/connect`; senão card desativado com texto por razão: `PKCE_DISABLED` "PKCE não configurado administrativamente", `SIMULATED_SOURCE` "Modo simulado — OAuth desativado", `MISSING_CONFIG` "Configuração OAuth incompleta".
- [ ] **Step 4: `page.tsx`** — `Promise.all` de contas, config e `getCurrentUser()`; renderizar `AccountCard`/`ConnectCard`.
- [ ] **Step 5: Verificar**

Run: `npm run typecheck && cd apps/web && npx eslint "src/app/(dashboard)/integrations" && npx next build`
Expected: sem erros; build conclui.

- [ ] **Step 6: Commit** — `git commit -m "feat(web): cards de contas ML com ações e estados"`

---

### Task 9: Teste de fluxo desconectar → reconectar

**Files:**
- Test: `apps/api/src/modules/integrations/account-management.spec.ts` (`describe('disconnect → reconnect flow')`)

**Interfaces:**
- Consumes: `IntegrationsService` e `MlOAuthService` reais sobre `MemoryPrisma`, `MarketplaceHttp` simulado.

- [ ] **Step 1: Teste** `'disconnect, reconnect with wrong seller is rejected, then the right seller restores the same account'`: conta `ACTIVE` seller `123` → `disconnect` → `startReconnect` → `exchangeCode` com `user_id:999` rejeita `SELLER_MISMATCH` (conta `DISCONNECTED`, tokens null) → novo `startReconnect` → `exchangeCode` com `user_id:123` → mesma `id`, `ACTIVE`, tokens decifráveis com `'a:123'`, 1 só conta.
- [ ] **Step 2: Correr** — `cd apps/api && npx jest account-management -t flow` → PASS.
- [ ] **Step 3: Commit** — `git commit -m "test(integrations): fluxo desconectar e reconectar"`

> O e2e com PostgreSQL (`npm run test:postgres`) precisa de `.local/observation.env`, que não existe neste servidor; fica fora deste plano salvo indicação do utilizador.

---

### Task 10: Validação completa e documentação

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Suite completa**

Run: `cd apps/api && npx jest --silent && cd ../.. && npm run typecheck && (cd apps/api && npm run build) && (cd apps/web && npx next build)`
Expected: todos os testes PASS (113 + novos); typecheck limpo; dois builds concluídos.

- [ ] **Step 2: Secret scan** — `node scripts/scan-secrets.mjs` → sem achados; `git diff main --stat` sem `.local/` nem `settings.local.json`.
- [ ] **Step 3: `CLAUDE.md`** — secção "Gestão de contas ML" com: `status` em vez de `isConnected`; tokens apagados ao desconectar; `displayName` vs `name`; reconexão via `oauth_states.expected_account_id` com validação de seller; hard delete com as três regras; route handlers JSON (sem Server Actions); migration `20261114_integrations_account_management` (aditiva).
- [ ] **Step 4: Commit** — `git commit -m "docs: decisões da gestão de contas ML"`
- [ ] **Step 5: Parar e reportar ao utilizador.** Ensaio (build de imagens com tag própria + migration na BD do ensaio + smoke) e produção só com OK explícito.
