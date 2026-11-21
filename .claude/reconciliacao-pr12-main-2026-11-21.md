# Reconciliação PR #12 ↔ main — análise de 2026-11-21 (não commitado)

Estado verificado:
- `origin/main` = `e1f35bf` (PR #11). Base comum = `0de434d`.
- PR #12 = `feature/ml-rate-limit-retry` @ `04d39d1` (publicado; sem force push).
- Worktree de integração: `/root/farmaecon-worktrees/pr12-integration`, branch `integration/pr12-main-reconciliation` a partir de `origin/main`, com `git merge --no-commit` do PR #12 **em curso** e **27 ficheiros em conflito, por resolver**.
- A resolução em lote foi bloqueada pelo classificador de ações (sobrescrita de 27 ficheiros). Nenhum ficheiro foi alterado por esse comando.

## Migrações
- 16 migrações partilhadas: **byte a byte iguais** nos dois lados (verificado por SHA-256).
- 8 exclusivas da branch, aditivas: `20261120_purchase_item_lot_dates` … `20261127_purchase_items_products_value`.
- Produção tem aplicadas as 16 partilhadas. Nenhuma migração existente deve ser editada.

## Classificação dos 27 conflitos (remoções medidas com `git diff --numstat`)

| Ficheiro | +/− (main→branch) | Classe | Análise |
|---|---|---|---|
| CLAUDE.md | +116 / 0 | B | Branch = main + secções. |
| apps/api/prisma/schema.prisma | +55 / 0 | B/E | Branch = main + 8 modelos aditivos. |
| apps/api/src/app.module.ts | +4 / 0 | B | Registo de `ads`/`lots`. |
| costs/bonus-allocation.ts | +7 / −1 | C | Tipo `BonusRule` ganha `GROUP_AVERAGE_NOMINAL`. |
| costs/cmv-preview.spec.ts | +1 / −1 | B | Campo novo em fixture. |
| costs/cost-pool-db.ts | +19 / 0 | B | Campos novos. |
| costs/document-parser.ts | +18 / −1 | B | Aviso multi-lote preservado com prefixo original, mais explicação. |
| costs/nfe-xml-parser.ts | +59 / 0 | B | IPI, ST, grupo med. |
| dre/cost-publication.service.ts | +46 / −9 | C | Caminho antigo (`applyBonusAllocation`) preservado para regras não-grupo; grupo tem caminho próprio. |
| dre/dre-preview.controller.ts | +14 / −1 | B | Import ampliado. |
| dre/dre-preview.service.ts | +36 / 0 | B | Lotes a vencer. |
| dre/dre-validation.spec.ts | +2 / −1 | B | Fixture. |
| dre/purchase-documents.controller.ts | +10 / −1 | B/C | `GROUP_AVERAGE_NOMINAL` e `ipiRecoverable`. |
| dre/purchase-invoice.service.ts | +8 / 0 | B | Campos novos. |
| margin/margin.controller.ts | +30 / 0 | B | Ranking, fee-changes, PUT rules. |
| margin/margin.service.ts | +17 / 0 | B | `ranking`, `feeChanges` (main intacta). |
| shared/prisma/prisma.service.ts | +4 / −2 | E | RLS: 15 → 17 tabelas (`product_lots`, `ads_costs`), coerente com as migrações. |
| shared/prisma/prisma.service.spec.ts | +5 / −3 | E | Mesma razão. |
| test/dre-cost-publish.postgres.e2e-spec.ts | +36 / −1 | B | Teste de grupo. |
| test/dre-ingest.postgres.e2e-spec.ts | +19 / 0 | B | Teste med. |
| test/margin.postgres.e2e-spec.ts | +44 / −4 | B | Helper de seed reescrito; títulos da main presentes. |
| web escritorio/page.tsx | +5 / −1 | B | `LotesResumoCard`; `MargemResumoCard` mantido. |
| web margin/preview/page.tsx | +109 / −1 | B | Ranking e regras. |
| web sidebar-nav.tsx | +1 / 0 | B | Entrada de lotes. |
| web api/integrations/api-bridge.ts | +6 / −1 | B | Assinatura com `PUT`. |
| web components/escritorio/AgentStatusList.tsx | +9 / −7 | D/H | `main` mostra estados fictícios ("Ativo", "Bloqueado"). Branch: "Offline" com legenda. **Decisão: branch** (regra da diretiva: sem estados inventados). |
| web components/escritorio/OfficeScene.tsx | +6 / −6 | D/H | Mesmo caso. **Decisão: branch.** |

## Testes de equivalência feitos
- Símbolos exportados: a `main` não tem nenhum símbolo que a branch não tenha (exceto variável local `results`).
- Títulos de teste (`it`/`describe`) nos specs e e2e: todos os da `main` existem na branch; a única diferença é a contagem RLS (15 vs 17), explicada acima.
- `margin.service.ts`: diff semântico = acréscimos apenas.

## Plano de resolução (pendente de execução)
1. Para os 27 ficheiros, resolver com a versão da branch **ficheiro a ficheiro**, depois de validar a classe acima (não usar `-X theirs` global).
2. Verificar ausência de marcadores de conflito.
3. Executar: `tsc`, testes unitários, build da API, build do web, E2E PostgreSQL, migrações numa base isolada.
4. Commit de resolução na branch `integration/pr12-main-reconciliation`; push normal; Draft PR referenciando #12.

## Bloqueio atual
A etapa 1 foi negada pelo classificador de ações por sobrescrever 27 ficheiros de uma vez. Aguarda autorização explícita para essa operação, ou uma permissão do utilizador nas definições do Claude Code para `git show`/redireção dentro do worktree de integração.

## Resultado da resolução (2026-11-21)

- Resolução: os 27 conflitos foram resolvidos ficheiro a ficheiro com `git checkout --theirs -- <ficheiro>` (versão da branch), após a verificação acima. Nenhum conflito com marcadores restou.
- Verificação extra: a árvore resultante é **idêntica** à de `feature/ml-rate-limit-retry` (0 ficheiros diferentes). Nenhum ficheiro existe só na `main` (0 ficheiros). Remoções em todo o diff `main → branch` foram todas lidas: 20 ficheiros, incluindo 4 não conflituosos (`products.service.ts`, `products.controller.ts`, `package.json` — acréscimos e a mudança intencional do `lint`; `ml-api.service.ts` — trabalho do próprio PR).
- Migrações: as 16 partilhadas são idênticas. As 8 aditivas da branch mantêm-se sem alteração.
- Commit de reconciliação: merge commit com `origin/main` e a branch como pais. Histórico original preservado; sem force push; sem reescrita.

### Validação (instalação limpa do worktree, `npm ci` + `prisma generate`)

| Verificação | Resultado |
|---|---|
| `tsc --noEmit` (API) | sem erros |
| Testes unitários (API) | 55 suites: **412 passam**, 1 ignorado |
| Build da API (`nest build`) | exit 0 |
| Build do frontend (`next build`) | exit 0 |
| E2E PostgreSQL (`npm run test:postgres`) | **11 suites, 54 testes passam**; migrações aplicadas do zero numa base isolada |

Notas de ambiente:
- A primeira tentativa de build do web falhou por causa de `node_modules` ligado por symlink ao repositório principal (o Turbopack resolve fora da raiz do worktree). Resolvido com instalação própria no worktree; não é defeito do código.
- A primeira tentativa de build da API falhou por o cliente Prisma não estar gerado no worktree. Resolvido com `prisma generate` a partir do schema da branch.

### Decisões de reconciliação
- Mantida a versão da branch em todos os 27 ficheiros, porque a análise demonstrou que contém a `main` mais acréscimos.
- `AgentStatusList.tsx` e `OfficeScene.tsx`: estados fictícios da `main` substituídos por "Offline" (correção de defeito).
- Regras fiscais: nenhuma regra nova foi introduzida. As decisões IPI, IBS/CBS, vigência e código fornecedor↔SKU continuam pendentes e assinaladas.

### Riscos que permanecem
- O commit traz para `main` cerca de 134 commits de trabalho ainda não validado em produção (margem, lotes, DRE, ADS, rate limit). A revisão do Draft PR continua obrigatória.
- Migrações `20261120`–`20261127` não foram aplicadas em produção. Qualquer aplicação exige backup e autorização explícita.
- Nenhum deploy foi feito.
