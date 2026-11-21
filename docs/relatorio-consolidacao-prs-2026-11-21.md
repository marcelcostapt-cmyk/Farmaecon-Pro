# Relatório de consolidação dos PRs #13 → #14 → #15 → #16

Data: 2026-11-21. Verificado sobre os heads: `main` e1f35bf · #13 `d9ba6f2` · #14 `aeb3ec3` · #15 `f6c85e6` · #16 `a0ed34c`/`3b80fbf` · #17 `ae960df`. Todos em Draft. Nenhum merge, deploy ou migração em produção.

## 1. Dependências e conflitos

- Cadeia linear: `main` ⊂ #13 ⊂ #14 ⊂ #15 ⊂ #16 ⊂ #17 (verificado com `git merge-base --is-ancestor`).
- Cada PR integra sem conflitos com o anterior (`git merge-tree --write-tree`, saída 0), incluindo #17 sobre #16.
- Histórico reescrito: nenhum (sem force push).

## 2. Migrações

| Ramo | Migrações | Novas face a `main` |
|---|---|---|
| `main` (produção aplicada) | 16 | — |
| #13 | 24 | 8 (`20261120`–`20261127`) |
| #14 | 25 | +`20261128_agent_runs` |
| #15 | 25 | — (sem migração nova) |
| #16 | 26 | +`20261129_ads_import_batches` |
| #17 | 26 | — (sem migração nova) |

- Nenhuma migração existente foi editada (diff: só acrescentos).
- Pendentes em produção: 10 (`20261120`–`20261129`). Não aplicar sem autorização explícita.
- Tabelas com RLS registadas nas listas do arranque e do restauro: 19 (`agent_runs`, `ads_import_batches` acrescentadas).
- Desvios de schema conhecidos e **pré-existentes** (não introduzidos aqui): `margin_rules` (tipo `DECIMAL(65,30)` no diff) e nomes de restrições herdados de migrações antigas. Não corrigidos para não alterar migrações aplicadas.

## 3. Segurança multiempresa (verificação por grep e testes)

- Todos os controladores novos têm `AuthGuard('jwt')`.
- Consultas novas filtram por `tenantId` e por conta; RLS ativa em todas as tabelas novas.
- Conta de outro tenant: 404 (execuções e importação); listagens vazias (E2E).
- Módulos ADS e agentes: nenhuma chamada HTTP ao Mercado Livre (grep).
- OPERATOR: não importa; executa análises de leitura; escrita de regras de margem: 403 (teste e ensaio).

## 4. Consistência financeira

- Investimento ADS não entra no DRE nem na margem (grep: `adsCost` só em `ads/`, `agents/` e no serviço Prisma).
- ROAS e ACOS: indisponíveis sem receita atribuída confiável (testes de fórmula e de apresentação).
- Escrita em `product_costs`: só na publicação aprovada existente (`cost-publication.service.ts`).
- Gestor: não recalcula; consolida execuções persistidas.

## 5. Persistência das execuções dos agentes

- Cada execução: `agent_runs` com estado real (RUNNING, COMPLETED, BLOCKED, FAILED), data, conta e resultado.
- `RUNNING` antigo (> 10 min) é fechado como FAILED, dentro do tenant, sem reexecução.
- Testes: unitários, E2E (incluindo falha injetada) e ensaio.

## 6. Estado por funcionalidade

**Prontas (validadas em PostgreSQL real e no ensaio, com dados sintéticos)**
- Gestor: mesa de reunião com estados reais.
- Analista: margem por SKU, alertas e variação de taxas, com evidências.
- ADS: investimento, distribuição, regras, cruzamento com o Analista, recomendações de revisão.
- Importação ADS: pré-visualização, erros por linha, tudo ou nada, idempotência, sobreposição com confirmação, auditoria.

**Parcialmente prontas**
- Analista: Mix Ativo (estoque, giro, Full, ruptura) não implementado.
- ADS: ROAS e ACOS dependem de uma fonte de receita atribuída.
- Importação ADS: campos com quebra de linha não são suportados; a deteção de sobreposição é linha a linha (não por campanha inteira).
- Anúncios: implementado sobre o catálogo local (PR #17). Não cobre anúncios publicados nem Buy Box. Os limites das regras são parâmetros de produto a confirmar.

**Bloqueios para operação real**
- Migrações não aplicadas em produção (10).
- Nenhuma conta real com custos publicados: a margem real depende das decisões fiscais.
- Nenhum CSV real de ADS validado pelo utilizador.
- Revisão humana dos PRs.

## 6b. Revisão da importação de custos (PR #13)

- Publicação (`cost-publication.service.ts`): só a partir de `PENDING_REVIEW`; fatura do tenant; exige conta vinculada; recusa custo zero ou negativo; transacional.
- Base de dados: CHECK `product_costs_publish_requires_rule` impede custo APPROVED sem regra de rateio.
- Não revisado em profundidade nesta rodada: a vigência por defeito (decisão #5, `cost-validity.ts`) e a regra de bonificação em casos com vários lotes. Ficam como pendências de negócio.

## 6c. Incidente operacional registado

- Durante a sessão, o disco do host (`/`) chegou a 0 MB livres. Causa: cache de build do Docker e imagens de ensaio acumuladas.
- Ação: `docker builder prune` (cache não usada) e limpeza de ficheiros temporários da própria sessão. Nenhuma imagem com tag, backup ou contentor foi removido.
- Consequência para a recuperação: antes de cada build ou backup, verificar o espaço livre. Em produção, nunca remover imagens de rollback sem decisão explícita. Manter o disco abaixo de 90%.

## 7. Decisões pendentes

- Fiscais: IPI recuperável (por documento ou por empresa); IBS/CBS na base; vigência (decisão #5); código fornecedor ↔ SKU (decisão #6); consumo de lote.
- Operacionais: fonte de receita atribuída às campanhas (ROAS/ACOS); integração do ADS na margem.
- Permissões: confirmação das APIs oficiais e escopos para SAC e Buy Box (Mercado Livre Brasil).
- Sobreposição de ADS: aceitar a confirmação de linha a linha, ou exigir confirmação por campanha inteira.
- Anúncios: limites das regras (título com 10 caracteres, margem de 40%, estoque de 3x o mínimo) e obrigatoriedade do registo Anvisa por categoria.

## 8. Ordem segura de integração

1. Revisão humana e merge de #13 em `main`.
2. Revisão e merge de #14 (base: #13 já em `main`).
3. Revisão e merge de #15 (base: #14).
4. Revisão e merge de #16 (base: #15).
5. Só então: backup, migrações e deploy (secção 9).

## 9. Backups, migração e recuperação

**Antes de qualquer alteração em produção**
1. `pg_dump -Fc` da base de produção; `pg_restore -l` para validar; `sha256sum` do dump.
2. Cópia de `production.env` e de `ROLLBACK_IMAGES` (tags atuais).
3. Contagens de referência: pedidos, contas, custos publicados, linhas de ADS (0 em produção).

**Aplicação**
1. Migrações na ordem `20261120` → `20261129`, a partir da imagem da API (`migrate deploy`).
2. Verificar o arranque (boot RLS com 19 tabelas) e `/health`.
3. Subir API e web com as novas tags, mantendo `MARKETPLACE_MODE=OBSERVATION`.

**Recuperação**
- Código: repor as tags de `ROLLBACK_IMAGES` e o mesmo comando de `up`.
- Schema: migrações aditivas, sem reversão automática. Restaurar o dump só com autorização explícita.
- Dados de ADS: remover apenas por ordem explícita, por `source_hash`, com a auditoria como referência.

## 10. Testes de referência (HEAD da cadeia)

- API unitários: 508 passam (1 ignorado). Web: 25 passam.
- E2E PostgreSQL: 85 passam (14 suítes).
- Typecheck, builds, `security:scan`, `test:deployment`, testes Python: código 0.
- CI: ver os PRs (último resultado registado em cada corpo de PR).
