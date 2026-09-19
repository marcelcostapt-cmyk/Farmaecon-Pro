# Arquitetura do Sistema: Farmaecon PRO

Este documento detalha a arquitetura do SaaS Multi-Marketplace **Farmaecon PRO**, desenhado para alta escalabilidade, isolamento de inquilinos (multi-tenant) e integração contínua com diversos marketplaces.

## 1. Visão Geral (C4 Model - Contexto)

O sistema Farmaecon PRO atua como um hub central, conectando os sellers (usuários do SaaS) aos seus respectivos marketplaces e sistemas ERP.

```mermaid
graph TD
    User([Seller / Gestor]) -->|Gerencia vendas, produtos e finanças| Farmaecon[SaaS Farmaecon PRO]
    Farmaecon <-->|Sincronização de Pedidos/Estoque| ML(Mercado Livre)
    Farmaecon <-->|Sincronização de Pedidos/Estoque| Amazon(Amazon)
    Farmaecon <-->|Sincronização de Pedidos/Estoque| Shopee(Shopee)
    Farmaecon <-->|Integração Fiscal/Logística| ERP(Bling / Tiny / Olist)
```

## 2. Componentes e Tecnologias (C4 Model - Container)

A arquitetura baseia-se num **Monorepo** para facilitar o compartilhamento de tipos (TypeScript) entre Frontend e Backend.

```mermaid
graph TD
    subgraph Farmaecon PRO Monorepo
        WebApp[Frontend Web App\nNext.js + Tailwind + shadcn]
        API[API Principal\nNestJS + TypeScript]
        Worker[Background Worker\nNestJS + BullMQ]
    end

    User([Usuário Final]) -->|Acessa Dashboard| WebApp
    WebApp -->|Requisições REST/GraphQL| API
    
    API <-->|Lê/Grava Dados| DB[(Banco de Dados\nPostgreSQL)]
    API -->|Publica Jobs| Cache[(Fila & Cache\nRedis)]
    Cache -->|Processa Filas| Worker
    
    Worker <-->|Chama APIs Externas| ML[APIs de Marketplaces]
```

### Decisões Tecnológicas
- **Frontend:** Next.js (App Router) para SSR e performance otimizada, TailwindCSS e shadcn/ui para design system premium e responsivo. TanStack Table e Recharts para grids complexos e visualização de dados.
- **Backend Core:** NestJS, que oferece injeção de dependências robusta e facilita a criação de módulos isolados (Auth, Finance, Integrations).
- **Banco de Dados:** PostgreSQL, modelado com campos `tenant_id` em todas as tabelas transacionais para garantir isolamento. Acesso a dados feito via Prisma ORM.
- **Assincronicidade e Jobs:** Redis + BullMQ. Fundamental para processar webhooks de marketplaces, sincronizar estoques em massa e gerar relatórios pesados sem bloquear a API principal.

## 3. Modelo de Dados Principal (ERD Simplificado)

O banco é relacional e desenhado para suporte multi-tenant (várias empresas/sellers) e multi-conta (várias contas de ML, Amazon sob o mesmo tenant).

```mermaid
erDiagram
    TENANT {
        uuid id PK
        string name
        string document
        datetime created_at
    }
    USER {
        uuid id PK
        uuid tenant_id FK
        string name
        string email
        string role "ADMIN, MANAGER, OPERATOR"
    }
    MARKETPLACE_ACCOUNT {
        uuid id PK
        uuid tenant_id FK
        string platform "MERCADO_LIVRE, AMAZON"
        string access_token
        string refresh_token
    }
    PRODUCT {
        uuid id PK
        uuid tenant_id FK
        string sku
        string title
        decimal cost_price
        decimal base_price
    }
    ORDER {
        uuid id PK
        uuid tenant_id FK
        uuid marketplace_account_id FK
        string external_order_id
        decimal total_amount
        string status
    }
    FINANCIAL_TRANSACTION {
        uuid id PK
        uuid tenant_id FK
        uuid order_id FK
        decimal amount
        string type "REVENUE, FEE, SHIPPING, TAX"
    }

    TENANT ||--o{ USER : has
    TENANT ||--o{ MARKETPLACE_ACCOUNT : owns
    TENANT ||--o{ PRODUCT : owns
    TENANT ||--o{ ORDER : processes
    ORDER ||--o{ FINANCIAL_TRANSACTION : generates
    PRODUCT ||--o{ ORDER : includes
    MARKETPLACE_ACCOUNT ||--o{ ORDER : receives
```

## 4. Segurança e Multi-Tenant

- **Autenticação:** JWT (JSON Web Tokens) com Refresh Tokens.
- **RBAC (Role-Based Access Control):** Controle granular. Um *Operador* não pode acessar o módulo DRE, apenas um *Gestor* ou *Admin*.
- **Isolamento de Dados (Tenant Isolation):** Todas as queries do Prisma devem obrigatoriamente injetar o `tenant_id` do usuário logado usando features do Prisma Client Extensions ou Guards/Interceptors do NestJS.
- **Tokens de Integração:** `access_token` de marketplaces são encriptados at-rest no banco de dados usando AES-256.

## 5. Escalabilidade e Deploy

A infraestrutura inicial usará Docker (através de `docker-compose` para ambiente de desenvolvimento).
Para a produção, os serviços devem ser conteinerizados separadamente (API e Worker) para permitir o escalonamento horizontal dos Workers independentemente da API. CI/CD será gerido via GitHub Actions.
