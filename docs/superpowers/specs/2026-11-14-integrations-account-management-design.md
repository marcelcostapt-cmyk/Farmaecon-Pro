# Gestão de contas Mercado Livre em `/integrations` — Design

Data: 2026-11-14 · Branch base: `feature/merge-ml-resumable-sync` (e33588e + docs)

## 1. Intenção

Hoje `/integrations` só lista as contas ML (nome técnico `ML #<sellerId>`, estado, nº de pedidos) e permite
"Sincronizar pedidos agora". O objetivo é tornar a página o sítio onde o utilizador **gere** as suas contas:
dar-lhes um nome reconhecível (ex.: "Farmashop"), desligar uma conta, voltar a ligá-la, ligar contas novas
e remover contas desligadas sem histórico — com estado visual claro e feedback em cada ação.

## 2. Objetivos, não-objetivos, anti-objetivos

**Objetivos**
- Nome amigável (`displayName`) editável inline por conta.
- Desconectar, reconectar (mesmo seller), conectar nova conta, remover conta desconectada.
- Cards com badge de estado, ações explícitas, loading, confirmação nas ações destrutivas.
- Card "Conectar Mercado Livre" a indicar se o OAuth/PKCE está disponível.

**Não-objetivos**
- Outras plataformas (Amazon/Shopee) — só aparecem como já aparecem.
- Soft delete / arquivo de contas.
- Revogação do token junto do Mercado Livre (não fazemos chamada de revogação; apagamos localmente).
- Mockup visual específico (não disponível); a UI segue as prioridades da secção 6.

**Anti-objetivos (falha mesmo que "funcione")**
- Reconectar acabar a criar uma conta nova ou a sobrescrever outra conta com tokens de outro seller.
- Remover uma conta apagar pedidos (o FK `orders → marketplace_accounts` é `ON DELETE CASCADE`).
- Uma conta desconectada continuar a gerar ticks de sync, refreshes de token ou jobs falhados.
- Expor o access token ao JavaScript do browser.
- Introduzir Server Actions novas (ressalva pré-deploy pendente no `CLAUDE.md`).

## 3. Restrições

- ORM: **Prisma 7** (sem TypeORM). Migrations em `apps/api/prisma/migrations/`, aplicadas por `migrate deploy`.
- RLS por tenant: a API usa o role `farmaecon_runtime`; todas as queries continuam filtradas por `tenantId`.
- Tokens cifrados com `TokenVault` (contexto `tenantId:sellerId`) — sem alteração.
- Estado da conta: **reutilizar `status`** (`ACTIVE` / `WARNING` / `DISCONNECTED`). Não há `isConnected`.
  Contas ≠ `ACTIVE` não sincronizam nem renovam tokens (já é assim em `ml-orders-sync.service.ts:80`
  e `ml-oauth.service.ts` `refreshToken`).
- Sem deploy em produção nem alteração de env/secrets de produção. Validação local + ensaio
  (o ensaio usa `MARKETPLACE_SOURCE=MOCK`, onde o OAuth está desativado por design).

## 4. Abordagens consideradas

| | Abordagem | Trade-off | Decisão |
|---|---|---|---|
| **A** | Página server-rendered + **componentes cliente** por card que fazem `fetch` a **route handlers Next** (`/api/integrations/...`), que reencaminham à API Nest com o cookie `access_token` httpOnly; `router.refresh()` após cada ação. | +4 route handlers pequenos e repetitivos; segue o padrão existente do `sync`; token nunca no JS. | **Escolhida** pelo utilizador. |
| B | Server Actions (`'use server'`). | Menos ficheiros, mas agrava a ressalva "Server Action" pendente. | Rejeitada. |
| — | Cliente a chamar a API Nest diretamente. | Exige token acessível ao JS. | Descartada. |

## 5. Decisões do utilizador (tal como decididas)

1. **Desconectar apaga os tokens** (`accessToken`, `refreshToken`, `expiresAt` = null), `status = DISCONNECTED`,
   remove o scheduler recorrente. Não se guardam tokens de contas desconectadas.
2. **`status`** em vez de `isConnected`.
3. **`displayName`** novo, nullable, ao lado de `name`. `name` continua a ser `ML #<sellerId>` (técnico).
   UI mostra `displayName ?? name`. Vazio/só espaços → guarda `null`.
4. **Reconectar exige o mesmo `externalSellerId`.** O `state` OAuth transporta o `accountId` esperado;
   no callback, seller diferente → erro claro, nada é criado nem sobrescrito.
5. **Remover = hard delete**, só se: `status = DISCONNECTED` **e** 0 pedidos ligados **e** 0 jobs pendentes
   para a conta. Com pedidos: mensagem
   *"Não é possível remover esta conta porque possui histórico de pedidos. Desconecte-a para parar a sincronização."*
6. UI: nome inline; badge ACTIVE verde / WARNING amarelo / DISCONNECTED cinza; botões
   "Sincronizar agora", "Desconectar", "Reconectar", "Remover"; card de conectar com estado PKCE;
   loading em ações; confirmação antes de desconectar/remover.
7. Abordagem A (acima).

## 6. Design

### 6.1 Base de dados (1 migration: `20261114_integrations_account_management`)
- `marketplace_accounts.display_name TEXT NULL` → Prisma `displayName String? @map("display_name")`.
- `oauth_states.expected_account_id TEXT NULL` → Prisma `expectedAccountId String? @map("expected_account_id")`.
  Sem FK (o state expira em 10 min; se a conta for apagada entretanto, o callback falha a validação).
- Migration só aditiva (colunas nullable) — compatível com contas existentes e com a imagem atual em rollback.
- `displayName` entra em `publicAccountSelect` (é dado público da conta, aparece também nos pedidos).

### 6.2 API (NestJS, `IntegrationsController`, todos sob `AuthGuard('jwt')`)

| Método/rota | Guard | Comportamento |
|---|---|---|
| `GET /integrations` | jwt | + `displayName`, + `nextSyncAt` (próximo tick do job scheduler `orders-sync-<id>`, `null` se não houver ou se o Redis falhar). |
| `GET /integrations/ml/config` | jwt | `{ oauthAvailable: boolean, reason: 'OK' \| 'SIMULATED_SOURCE' \| 'PKCE_DISABLED' \| 'MISSING_CONFIG' }` — mesma lógica das verificações de `buildAuthorizationUrl`, sem expor valores. |
| `PATCH /integrations/:id` | **Admin** | Body `{ displayName: string \| null }` (class-validator: string, trim, 1–60 chars; `''`/espaços → `null`). Conta tem de pertencer ao tenant (404 se não). Devolve a conta pública. |
| `POST /integrations/:id/disconnect` | **Admin** | Já existe. Mantém: apaga tokens + `DISCONNECTED` + `removeRecurring`. **Novo:** remove jobs pendentes do `token-refresh` dessa conta (hoje ficariam a falhar 3× com `findFirstOrThrow`). Idempotente se já desconectada. |
| `POST /integrations/:id/reconnect` | **Admin** | Conta do tenant, `status = DISCONNECTED`, `externalSellerId` presente (senão 409). Devolve `{ url }` como o `connect`, mas grava `expectedAccountId` no `OAuthState`. |
| `POST /integrations/ml/callback` | **Admin** | Já existe. Se o state tiver `expectedAccountId`: carregar conta (tenant) e exigir `String(tokens.user_id) === account.externalSellerId`; se não → `409 SELLER_MISMATCH`, sem escrever nada (o state fica consumido). Se OK → atualiza **essa** conta por `id` (tokens + `ACTIVE`, sem mexer em `displayName`), agenda refresh e sync inicial. Sem `expectedAccountId` → fluxo atual (upsert por seller). |
| `DELETE /integrations/:id` | **Admin** | 404 se não for do tenant; 409 `ACCOUNT_NOT_DISCONNECTED` se `status ≠ DISCONNECTED`; 409 `ACCOUNT_HAS_ORDERS` se `count(orders) > 0`; 409 `ACCOUNT_HAS_PENDING_JOBS` se houver jobs `waiting/active/delayed/prioritized/waiting-children` com `data.accountId` igual em `marketplace-sync` ou `token-refresh`. Caso contrário remove o scheduler (defensivo) e `delete` (o `marketplace_sync_states` cai por cascade). |
| `POST /integrations/:id/sync` | jwt | Inalterado (qualquer utilizador do tenant). |

Erros 409 devolvem `{ code, message }` com mensagem em PT pronta a mostrar.

Regras transversais:
- O callback de **conectar nova conta** continua a fazer upsert por `(tenant, platform, seller)`: se o seller
  já existir (mesmo desconectado), religa essa linha — comportamento atual, mantido.
- Tudo o que muda estado de conta corre dentro do contexto do tenant (RLS).

### 6.3 Web (Next.js 14 App Router)

**Route handlers novos** em `apps/web/src/app/api/integrations/` — mesmo padrão do `sync` (cookie
`access_token`, verificação de `Origin` contra `FRONTEND_URL`), mas respondem **JSON** (`{ ok, code?, message? }`
+ status HTTP da API) em vez de redirect, porque são chamados por `fetch`:
- `[id]/route.ts` → `PATCH` (rename) e `DELETE` (remover)
- `[id]/disconnect/route.ts` → `POST`
- `[id]/reconnect/route.ts` → `POST` → `{ url }`; o cliente faz `window.location.assign(url)`
- `[id]/sync/route.ts` → passa a aceitar `fetch` (JSON) mantendo o modo form/redirect atual por compatibilidade.

**Callback** `app/auth/callback/route.ts`: distinguir o 409 `SELLER_MISMATCH` → redirect
`/integrations?error=seller_mismatch`; `callback-handler.tsx` mostra
*"A conta Mercado Livre autenticada não corresponde a esta integração. Entre com a conta original e tente novamente."*
Reconexão bem-sucedida usa `success=ml_reconnected` ("Conta reconectada").

**Página** `(dashboard)/integrations/page.tsx` continua server component: carrega `GET /integrations` e
`GET /integrations/ml/config`, e o papel do utilizador (para esconder ações de admin a não-admins).
Novo componente cliente `account-card.tsx`:
- Cabeçalho: ícone, **nome** (`displayName ?? name`) com lápis → input; Enter/blur grava, Esc cancela;
  `name` técnico em texto pequeno quando há `displayName`.
- Badge: `ACTIVE` verde "Ativa", `WARNING` amarelo "Atenção", `DISCONNECTED` cinza "Desconectada";
  sync em curso (`syncStatus` PARTIAL/RUNNING) → badge azul "Sincronizando…".
- Linha de info: nº de pedidos, última sincronização, próxima sincronização (`nextSyncAt`).
- Ações ativas: "Sincronizar agora" (botão principal, com loading) e "Desconectar" (confirm nativo).
- Ações desconectada: "Reconectar" (principal) e "Remover" (confirm nativo; mostra a mensagem 409 da API).
  Card com opacidade reduzida / fundo neutro.
- Todos os botões com estado de loading e desativados durante o pedido; erro inline no card.
- Não-admin: só vê "Sincronizar agora"; nome não editável.

Card "Conectar Mercado Livre": se `oauthAvailable` → link para `/api/integrations/ml/connect`;
senão → card desativado com a razão ("PKCE não configurado administrativamente", "Modo simulado", …).

Componentes: reaproveitar `components/ui` (`card`, `badge`, `button`); ícones inline (SVG) — sem dependências novas.

### 6.4 Testes
- **API (jest, `*.spec.ts` ao lado dos serviços)**: rename (trim, vazio→null, limite, outro tenant → 404);
  disconnect (tokens null, scheduler e token-refresh removidos, idempotente); reconnect (só DISCONNECTED,
  grava `expectedAccountId`); callback com `expectedAccountId` (seller igual → atualiza a mesma conta;
  **seller diferente → 409 e nenhuma escrita**); delete (as três regras 409 + sucesso); `ml/config` (razões).
- **Integração**: no padrão de `apps/api/test/security.postgres.e2e-spec.ts`, fluxo disconnect → reconnect
  com seller errado (rejeitado, conta intacta) e certo (mesma `id`, `ACTIVE`), com HTTP do ML simulado.
- **Web**: não há testes web no projeto; validação por `typecheck` + `lint` + `next build` e verificação manual.

### 6.5 Validação e entrega
- Local: `test`, `typecheck`, `build` de api e web.
- Ensaio: imagens novas com tag própria, migration aplicada à BD do ensaio, smoke da página e endpoints
  (OAuth real não é testável no ensaio — `MOCK`).
- Produção: **só com aprovação explícita**; migration aditiva, rollback por imagem sem tocar na BD.
- `CLAUDE.md` atualizado com as decisões técnicas.

## 7. Deixado ao construtor
- Nomes exatos de ficheiros/componentes e divisão em sub-componentes.
- Cópia exata dos textos de UI além das mensagens fixadas acima.
- Forma de obter o papel do utilizador no server component (reaproveitar o que o dashboard já usa).
- Como simular o HTTP do ML no teste de integração (`MarketplaceHttp` é injetável).

## 8. Decisões minhas (a confirmar na leitura)
- Rename/disconnect/reconnect/remover só para **ADMIN**; sync aberto a todos.
- `expected_account_id` em `oauth_states` (coluna, não codificado no `state`).
- Disconnect também limpa jobs pendentes do `token-refresh`.
- `displayName` limitado a 60 caracteres e incluído em `publicAccountSelect`.
- `nextSyncAt` e `GET /integrations/ml/config` (necessários para "próxima sincronização" e estado PKCE).
- Seller mismatch consome o state (o utilizador tem de clicar "Reconectar" de novo).
- No callback de reconexão não se exige que a conta ainda esteja `DISCONNECTED` (ex.: reconectada noutro
  separador) — basta pertencer ao tenant e o seller coincidir; os tokens são atualizados.
- Contas `DISCONNECTED` não mostram "Sincronizar agora" (a API recusaria de qualquer forma).
