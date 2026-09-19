# SKILLS ATIVAS — Farmaecon PRO

Este documento registra todas as skills de desenvolvimento ativas para o projeto.
Cada agente do `agents.json` deve consultar as skills do seu domínio antes de implementar.

---

## 🏗️ ARCHITECT_AGENT

### `architect-review`
- Revisar toda decisão arquitetural de alto impacto.
- Usar antes de adicionar novos módulos ou bounded contexts.
- Garantir conformidade com Clean Architecture, SOLID e DDD.

### `ddd-context-mapping`
Separação de contextos:
1. Mapear todos os pares de contextos e direção de dependência.
2. Aplicar padrões: Shared Kernel, Anti-Corruption Layer, Open Host Service.
3. Definir ownership de contratos e regras de tradução.
4. Documentar falhas e fallbacks.

**Bounded Contexts deste projeto:**
- `Identity` (Tenant, User, RBAC)
- `Integration` (MarketplaceAccount, OAuth, Tokens)
- `Catalog` (Product, SKU, Cost)
- `Orders` (Order, Status, Sync)
- `Finance` (DRE, Transaction, Expense)
- `Logistics` (Stock, Shipment, Label)
- `Automation` (Messages, Rules, Alerts)

---

## 🔧 BACKEND_AGENT

### `api-patterns`
- API REST como estilo padrão (REST para este contexto — múltiplos clientes, CRUD dominante).
- Formato de resposta: envelope padrão `{ data, meta, error }`.
- Versionamento: URI (`/api/v1/...`).
- Rate limiting obrigatório em rotas públicas.
- Autenticação: JWT + Refresh Tokens.

### `database-design`
- PostgreSQL com Prisma ORM (já escolhido).
- Multi-tenant: `tenant_id` obrigatório em todas as tabelas transacionais.
- Index em: `(tenant_id, created_at)` para queries de dashboard.
- Index em: `(tenant_id, sku)` para busca de produtos.
- Evitar `SELECT *` em produção; usar `select` explícito no Prisma.
- Migrations: sempre criar migrations reversíveis.

### `bullmq-specialist`
Princípios para as filas do projeto:

| Fila | Propósito | Concorrência | Retry |
|------|-----------|-------------|-------|
| `marketplace-sync` | Sincronizar pedidos/anúncios | 5 | 3x exponential |
| `stock-sync` | Debitar estoque entre contas | 3 | 5x exponential |
| `token-refresh` | Renovar tokens OAuth | 2 | 3x linear |
| `notifications` | Mensagens pós-venda | 10 | 3x exponential |
| `reports` | Geração de relatórios pesados | 2 | 2x linear |

**Regras obrigatórias:**
- `maxRetriesPerRequest: null` na conexão Redis (obrigatório BullMQ).
- Handlers para `failed` e `stalled` em todos os workers.
- Graceful shutdown com `SIGTERM` em todos os workers.
- Job data: passar apenas IDs — nunca payloads completos.
- Bull Board em `/admin/queues` (protegido por RBAC ADMIN).

---

## 💻 FRONTEND_AGENT

### `nextjs-best-practices`
- Componentes Server por padrão; adicionar `'use client'` apenas quando necessário.
- Rota structure:
  ```
  app/
  ├── (auth)/           # login, register
  ├── (dashboard)/      # área autenticada
  │   ├── layout.tsx    # sidebar + header
  │   ├── page.tsx      # dashboard master
  │   ├── orders/
  │   ├── products/
  │   ├── finance/
  │   ├── integrations/
  │   └── settings/
  └── api/              # route handlers (proxy leve)
  ```
- Data fetching de KPIs: `revalidate: 60` (ISR de 1 minuto).
- Mutations de formulários: Server Actions com Zod.
- `loading.tsx` e `error.tsx` em cada rota do dashboard.

### `shadcn`
- Inicializar com: `npx shadcn@latest init --defaults` no `apps/web`.
- Sempre verificar componentes instalados antes de criar custom.
- Mapeamento de componentes para módulos do projeto:

| Módulo | Componentes shadcn |
|--------|-------------------|
| Dashboard KPIs | `Card`, `Badge`, `Chart` |
| Tabela de pedidos | `Table`, `Skeleton`, `Pagination` |
| Filtros | `Select`, `DatePicker`, `Input`, `Button` |
| Modais | `Dialog`, `Sheet`, `AlertDialog` |
| Alertas | `Alert`, `sonner` (toast) |
| Navegação | `Sidebar`, `Breadcrumb`, `Tabs` |

- Usar tokens semânticos: `bg-primary`, `text-muted-foreground` — nunca raw colors.
- Spacing: `flex gap-*` — nunca `space-y-*`.

### `react-component-performance`
- Identificar re-renders usando React DevTools Profiler.
- KPI cards com polling: isolar estado de `tick/refresh` em child components.
- Tabela de pedidos: virtualizar listas com mais de 100 linhas.
- Usar `memo` + `useCallback` em rows de tabelas grandes.
- Derivações de totais: sempre `useMemo`.

---

## 💰 FINANCE_AGENT

**Regras de negócio para DRE:**
```
Receita Bruta = Preço de Venda × Quantidade
Desconto MP = Comissão do Marketplace (%)
Custo Produto = custo_price do SKU
Custo Frete = frete cobrado pelo marketplace
Imposto = alíquota configurada por tenant
----------------------------------------------
Lucro Bruto = Receita Bruta - Desconto MP - Custo Produto
Lucro Líquido = Lucro Bruto - Custo Frete - Imposto - Despesas
Margem Líquida (%) = Lucro Líquido / Receita Bruta × 100
```

---

## 🧪 QA_AGENT

### `tdd-workflow`
Ciclo obrigatório para lógica financeira e de tenant isolation:

```
🔴 RED   → Escrever teste que falha (comportamento esperado)
🟢 GREEN → Código mínimo para passar
🔵 REFACTOR → Melhorar sem quebrar
```

**Prioridade de testes no projeto:**
1. Cálculos de DRE e margem (unitários, Jest)
2. Isolamento de tenant (integração, Prisma test client)
3. Fluxo OAuth e refresh de token (integração)
4. RBAC por rota (integração)
5. E2E dos fluxos críticos (Playwright)

### `webapp-testing`
- Usar Playwright (Python) para testes E2E dos fluxos críticos.
- Fluxos a cobrir:
  - Login e redirect para dashboard
  - Vinculação de conta marketplace (mock OAuth)
  - Visualização de DRE com dados de seed
  - Exportação de relatório CSV

---

## 🚀 DEVOPS_AGENT

### `docker-expert`
Dockerfiles com multi-stage build:

**`apps/api/Dockerfile`:**
- Stage `deps`: `npm ci --only=production`
- Stage `build`: `npm ci` + `npm run build`
- Stage `runtime`: node:20-alpine, non-root user, HEALTHCHECK

**`apps/web/Dockerfile`:**
- Stage `build`: `npm run build` (Next.js standalone output)
- Stage `runtime`: node:20-alpine, non-root user

**docker-compose.yml (dev):**
- Healthcheck no postgres: `pg_isready`
- Internal network (`backend`) para isolar DB/Redis do mundo externo
- Resource limits em todos os serviços

### `github-actions-templates`
Workflows a criar em `.github/workflows/`:

| Workflow | Trigger | Jobs |
|----------|---------|------|
| `ci.yml` | push/PR → main | lint + test (api + web) |
| `build.yml` | push → main | build Docker images → ghcr.io |
| `deploy.yml` | tag `v*` | deploy com approval gate |
| `security.yml` | push → main | Trivy vulnerability scan |

---

## Status

| Skill | Agente | Status |
|-------|--------|--------|
| `architect-review` | ARCHITECT | ✅ Ativa |
| `ddd-context-mapping` | ARCHITECT | ✅ Ativa |
| `api-patterns` | BACKEND | ✅ Ativa |
| `database-design` | BACKEND | ✅ Ativa |
| `bullmq-specialist` | BACKEND/SYNC | ✅ Ativa |
| `nextjs-best-practices` | FRONTEND | ✅ Ativa |
| `shadcn` | FRONTEND | ✅ Ativa |
| `react-component-performance` | FRONTEND | ✅ Ativa |
| `tdd-workflow` | QA | ✅ Ativa |
| `webapp-testing` | QA | ✅ Ativa |
| `docker-expert` | DEVOPS | ✅ Ativa |
| `github-actions-templates` | DEVOPS | ✅ Ativa |
