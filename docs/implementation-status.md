# Estado de implementação

## Checkpoint 22 — integração PR #13 e CI (2026-11-21)

Branch: `integration/pr12-main-reconciliation` (PR #13, Draft, base `main`). Referencia o PR #12 (histórico).

### Commits desta etapa
- `30be37c` merge com `origin/main` (27 conflitos resolvidos com a versão da branch, após verificação de superset).
- `7891135` smoke de browser usa o item de navegação atual para o relatório (a entrada duplicada foi removida em `e1f35bf`).
- `888bdd2` verificação de restauro usa a lista canónica de 17 tabelas com RLS (14 estava desatualizada).
- `975cfa3` barra lateral sem prefetch de rotas protegidas (ver decisões).
- `45ebcdd` listagem de pedidos não expõe identidade fiscal da conta (minimização).

### Evidência
- `test:production-stack`: PASS (imagens, migrações, bootstrap, login, relatório privado, renovação de sessão, backup cifrado e restauro isolado).
- Unitários API: 56 suites, 415 passam, 1 ignorado. E2E PostgreSQL: 11 suites, 54 passam.
- Build web OK; testes web 5/5.
- CI do GitHub no commit `8fc82e0`: dois runs (`44904237108`, `44904233227`), ambos success, 34/34 passos cada (inclui security:scan, test:postgres, test:browser, test:production-stack).

### Problemas encontrados e estado
- Renovação de sessão: a causa é a concorrência de prefetch com refresh de uso único (ver decisões). Corrigida na barra lateral.
- Exposição: identidade fiscal chegava a todas as listagens de pedidos. Corrigida; integrações mantêm os campos.
- `main` (`e1f35bf`) falhava o mesmo CI desde a subida para Next 16.4.6 e a remoção do link de observação.

## Checkpoint 21 — estado verificado em 2026-11-21

Branch: `feature/ml-rate-limit-retry` (base `8cbab63`). Commits desta sessão: `d8448e5` (repetição de 429 do Mercado Livre), `1fb44a7` (secção de estado no `CLAUDE.md`). Nenhum deploy.

### Verificado nesta sessão
- Testes unitários da API: 55 suites, 410 testes a passar, 1 ignorado. `tsc --noEmit` sem erros.
- Testes E2E em PostgreSQL real: não reexecutados neste checkpoint.
- Produção: API e web em `94612a9`, modo OBSERVATION, sem alterações nesta sessão.
- Ensaio: API `8cbab63-rehearsal-20261121-094605` (decisão #2 validada: custo unitário 12,211833 nas linhas 2 e 4), web `bb99b54-officecard`, 24 de 24 migrations.

### Entregue nesta sessão
- Repetição de 429 em `requestForAccount` (`ml-api.service.ts`): até 3 novas tentativas, espera por `Retry-After` ou backoff de 2, 4 e 8 s, teto de 10 s. Ao esgotar, mantém o erro `Mercado Livre API error 429`, classificado como `RATE_LIMITED`.
- Testes em `ml-api.rate-limit.spec.ts` (5 casos).

### Limites conhecidos da repetição de 429
- A fila `marketplace-sync` não tem `concurrency` configurada, por isso processa um job de cada vez. Uma espera de até 30 s atrasa as outras contas nesse intervalo. Cabe nos 15 minutos entre ticks.
- Os valores de espera são heurísticos. A documentação do ML não foi consultada nesta sessão, e os 429 não registam cabeçalhos de limite.
- Em produção, a eficácia só se confirma depois de deploy e observação das falhas por dia.

### Estado funcional (resumo; detalhe em `.claude/auditoria-farmaecon-2026-11-21.md`)
- Implementado e validado no ensaio: lotes e validades (gestão e alocação FEFO/FIFO, UI validada no browser), margem por SKU (preview e alertas validados no browser; ranking e alertas de tarifa com validação só pela API), ADS por importação CSV (validado pela API), grupo med (Anvisa) na NF-e (validado pela API), custo médio por grupo (decisão #2, validado pela API).
- Implementado, não em produção: as migrations `20261120` a `20261127`, e com elas lotes, margem, ADS e DRE de documentos.
- Pendente de decisão do Márcio: ver `dre-7-decisoes-negocio.md` e a secção de decisões em `CLAUDE.md`.

# Estado de implementação

## Checkpoint 20 — sincronização retomável de pedidos

Data: 2026-10-03 (UTC)

Branch: `feature/ml-resumable-sync`

### Entregue nesta branch

- Paginação de pedidos processada uma página por job, com tamanho padrão de 50.
- `marketplace_sync_states` persistindo `next_offset`, `expected_total`, páginas concluídas, contagem processada e estado por tenant/conta.
- Upsert idempotente por `tenant_id + marketplace_account_id + external_order_id`.
- Transição explícita `PARTIAL → COMPLETE` e `FAILED` para falhas sanitizadas.
- Continuação BullMQ com job determinístico por conta e offset.
- Retomada a partir do cursor persistido após falha.
- Relatório de Observação exibindo estado, cobertura esperada/importada, próximo offset e última sincronização.
- Nenhum endpoint comercial de escrita foi adicionado; o modo permanece `OBSERVATION`.
- O workflow de CI agora exporta as imagens verificadas como artefato versionado e gera `SHA256SUMS` após o smoke test local.

### Evidências locais

- Testes API: 32 testes passaram, incluindo retomada após falha, reexecução idempotente, cursores independentes por conta e transição `PARTIAL → COMPLETE`.
- Typecheck API/Web: passou.
- Build API/Web: passou.
- A validação local não usa contas reais nem tokens reais.

### Ainda não comprovado

- Nenhuma conta real foi sincronizada por esta branch.
- Não há contagem ou amostra manual comparada com a fonte Mercado Livre nesta sessão.
- O workflow de CI desta branch ainda não foi executado em um runner nem o artefato foi promovido para a VPS.
- Checksum de um artefato CI e migração contra uma cópia do banco de produção ainda precisam ser validados antes de qualquer deploy.

### Próximo gate

1. Executar CI completo e gerar artefato rastreável.
2. Validar SHA-256 do artefato contra o valor publicado pelo CI.
3. Aplicar a migration em banco de teste e validar restore.
4. Fazer deploy controlado apenas de API/Web, após autorização explícita.
5. Sincronizar uma única conta real em leitura, comparar uma amostra com o Mercado Livre e registrar o resultado.
