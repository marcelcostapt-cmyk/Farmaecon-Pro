# Farmaecon PRO — SaaS Multi-Marketplace

Plataforma SaaS multi-tenant para gestão 360° de marketplaces (Mercado Livre, Amazon, Shopee e mais). Unifica vendas, finanças (DRE), estoque e automação em um único painel.

## Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| Frontend | Next.js 15 (App Router) + Tailwind + shadcn/ui |
| Backend | NestJS + TypeScript |
| Banco de Dados | PostgreSQL 15 via Prisma ORM |
| Filas | Redis 7 + BullMQ |
| Infra | Docker + GitHub Actions CI/CD |

## Estrutura do Monorepo

```
FARMAECON PRO/
├── apps/
│   ├── api/          # NestJS — REST API
│   │   ├── src/modules/
│   │   │   ├── auth/         # JWT + Passport
│   │   │   ├── tenants/      # Multi-tenant
│   │   │   ├── users/        # RBAC
│   │   │   ├── integrations/ # OAuth + sync jobs
│   │   │   ├── products/     # Catálogo + custos
│   │   │   ├── orders/       # Pedidos
│   │   │   └── finance/      # DRE + despesas
│   │   ├── prisma/           # Schema + seed
│   │   └── Dockerfile
│   └── web/          # Next.js — Dashboard
│       ├── src/app/
│       │   ├── (dashboard)/  # Área autenticada
│       │   │   ├── dashboard/
│       │   │   ├── orders/
│       │   │   ├── finance/
│       │   │   └── integrations/
│       └── Dockerfile
├── docs/             # Arquitetura, backlog, onboarding
├── .github/workflows/ci.yml
├── docker-compose.yml
└── setup.sh
```

## Início Rápido (Desenvolvimento)

```bash
# 1. Clonar e entrar no diretório
cd "FARMAECON PRO"

# 2. Executar o setup completo (instala deps, sobe Docker, migra banco e semeia dados)
chmod +x setup.sh && ./setup.sh

# 3. Iniciar os servidores (dois terminais)
cd apps/api && npm run dev          # API em :3001
cd apps/web && npm run dev          # Frontend em :3000
```

### Credenciais de Teste (Seed)

| Campo | Valor |
|-------|-------|
| Email | `admin@farmaecon.com` |
| Senha | `admin1234` |

## API — Endpoints Principais

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/v1/auth/login` | Autenticação |
| GET | `/api/v1/auth/me` | Perfil do usuário |
| GET | `/api/v1/orders` | Listar pedidos (tenant) |
| GET | `/api/v1/products` | Listar produtos (tenant) |
| POST | `/api/v1/products` | Criar/atualizar produto |
| GET | `/api/v1/finance/dre?from=&to=` | DRE por período |
| POST | `/api/v1/finance/expenses` | Lançar despesa |
| GET | `/api/v1/integrations` | Listar contas conectadas |

## Comandos Úteis

```bash
# Backend
cd apps/api
npm run dev          # Iniciar em modo dev (watch)
npm run db:push      # Aplicar schema sem migration
npm run db:seed      # Repopular banco com dados demo
npm run db:studio    # Abrir Prisma Studio
npm test             # Rodar testes unitários

# Frontend  
cd apps/web
npm run dev          # Iniciar Next.js em :3000
npm run build        # Build de produção

# Docker (infra)
docker compose up -d    # Subir Postgres + Redis
docker compose down     # Derrubar containers
```

## Bounded Contexts (DDD)

| Contexto | Módulo NestJS | Responsabilidade |
|----------|--------------|-----------------|
| Identity | `auth`, `users`, `tenants` | JWT, RBAC, multi-tenant |
| Integration | `integrations` | OAuth, tokens, sync jobs |
| Catalog | `products` | SKUs, custos, margens |
| Orders | `orders` | Pedidos, status, vendas |
| Finance | `finance` | DRE, despesas, lucros |

## Roadmap

- **v1 (Atual):** MVP estrutural com Auth, RBAC, DRE, Pedidos e Integrações
- **v2:** Integração real Mercado Livre (OAuth), sincronização automática de pedidos
- **v3:** Stock Sync, Shipment Center, mensageria pós-venda
- **v4:** IA de precificação, previsão de demanda, análise de sentimento

## Documentação

- [`docs/production-observation.md`](./docs/production-observation.md) — Preparação da VPS, variáveis atuais, validação Docker, backup, recuperação e bloqueios para conta real
- [`docs/architecture.md`](./docs/architecture.md) — Diagramas C4 e ERD
- [`docs/backlog_roadmap.md`](./docs/backlog_roadmap.md) — Épicos, histórias e roadmap
- [`docs/onboarding.md`](./docs/onboarding.md) — Guia de onboarding e integração
