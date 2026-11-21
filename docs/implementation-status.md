# Estado de implementação

## Checkpoint 25 — responsabilidades finais dos seis agentes C2 (2026-11-21)

Branch: `feature/office-agents-mvp` (PR #14, Draft). Não está em produção.

### CI
- `cdb2ece`: **success** nos dois runs (`44916449341` com pass em 8m33s e `44916452919` com pass em 9m05s). Verificado com `gh pr checks 14`.

### Decisões aplicadas
- Gestor (`central-farma`) coordena e consolida; não recalcula. O resultado é o do Analista, com `consolidation`.
- Analista (`dose-certa`) executa a análise determinística de margem. Mix Ativo é especialização (estoque, giro, Full, ruptura), ainda não implementada.
- Anúncios = `vitrine-farma` (catálogo, qualidade, preços; Buy Box só após confirmação oficial).
- Criativo = `criativo` (novo, sem serviço próprio).
- ADS = `giro-ads`; SAC = `balcao-digital`.
- Buy Box e SAC: apenas documentação. Nenhum endpoint novo, nenhum escopo OAuth novo.

### Código
- Análise movida para `agents/analista/margem-analysis.ts`.
- Catálogo: seis agentes públicos; Mix Ativo removido como agente separado.
- Painel de execução escolhe entre Gestor e Analista.
- Commits: `87` (API) e `9c68c99` (web) na sequência; ver histórico do branch.

### Evidências (HEAD `9c68c99`)
- API: 58 suítes, **440 passam** (1 ignorado). Módulo agents: 25.
- Web: **13 passam**.
- E2E PostgreSQL real: 12 suítes, **64 passam** (inclui Analista e consolidação do Gestor com mesmos summary/findings).
- Typecheck, `nest build`, `next build`: código 0.
- Ensaio (`9c68c99-agents5`, dados sintéticos, backup `/opt/farmaecon/backups/pre-agents5-rehearsal-*`):
  - Seis nomes públicos visíveis; "Mix Ativo" não aparece como agente; Vitrine Farma aparece como Anúncios.
  - Painel oferece Gestor (interno: Central Farma) e Analista (interno: Dose Certa).
  - Execução do Analista: "Concluído" com achados.

### Não comprovado
- Buy Box e SAC: sem implementação, por decisão.
- Estoque e Full do Mercado Livre: sem dados sincronizados.
- Dados reais de conta Mercado Livre: o ensaio é sintético.

### Próximo gate
Revisão humana do Draft PR #14. Nenhum merge, deploy ou migração em produção.

## Checkpoint 24 — nomes C2, recuperação de execuções e validação de estados (2026-11-21)

Branch: `feature/office-agents-mvp` (PR #14, Draft, base `integration/pr12-main-reconciliation`).

### Decisão de nomenclatura
- Interface pública: Gestor, Analista, Anúncios, Criativo, ADS e SAC (design C2).
- Identificações internas: Central Farma, Dose Certa, Mix Ativo, Vitrine Farma, Giro Ads, Balcão Digital. Correspondência 1:1 em `docs/agentes-escritorio.md`.
- O agente implementado mantém a chave técnica `central-farma` e continua a executar; passa a aparecer como Gestor (interno: Central Farma).

### Entregue
- Catálogo com `publicName`, `internalName` e `accent` (tokens `--fa-ag-*`).
- Recuperação segura: RUNNING com mais de 10 minutos passa a FAILED, dentro do tenant, sem reexecução e sem apagar histórico.
- Seletor "Conta em análise" (`?conta=`). Cartão Margem por SKU e catálogo (`GET /agents?account_id=`) seguem a conta; o cartão mostra o escopo.
- Permissões: OPERATOR pode ver e executar a análise de leitura; escrita de regras de margem continua ADMIN.
- Ids de conta não UUID são aceites e resolvidos sempre dentro do tenant (a conta de seed do ensaio tinha id não UUID e o escritório falhava ao carregar).

### Evidências (HEAD `051a44d`)
- CI de `db71c37` (correção do typecheck): **success** nos dois runs (`44913340620`, `44913336303`).
- Testes: API 58 suítes, 439 passam (1 ignorado); web 13 passam; E2E PostgreSQL real 12 suítes, 63 passam.
- Typecheck (`npm run typecheck`), `nest build`, `next build`, `security:scan`, `test:deployment`, testes Python: todos com código 0.
- Isolamento: teste E2E com conta de outro tenant devolve margem e execuções vazias, e recuperação de outro tenant não toca em RUNNING alheio.
- Recuperação: teste unitário (escopo, cutoff exato) e E2E (RUNNING antigo fechado; recente intacto).
- Estado FAILED real: E2E com falha injetada na margem. Mensagem persistida genérica, sem detalhe interno.
- Ensaio (imagem `farmaecon-api:051a44d-agents4`, dados sintéticos, backup `/opt/farmaecon/backups/pre-agents4-rehearsal-*`):
  - Nomes públicos e interno visíveis; sem "Offline"; "Nunca executado" quando não há execução.
  - Execução presa (criada no ensaio com 1 h) aparece como "Falhou" com mensagem de interrupção.
  - Conta sem pedidos ("Loja sem pedidos (ensaio)", criada no ensaio): "Bloqueado por dependência", motivo "Ainda não há pedidos sincronizados", sem números.
  - Conta com pedidos: cartão de margem com escopo "Conta: Loja pipeline" e 1 SKU abaixo do limite.
  - OPERATOR (`teste-operador@ensaio.local`): vê o escritório, executa e obtém "Concluído"; `PUT /api/margin/rules` → 403.

### Ainda não comprovado
- Estado FAILED de análise falhada no browser (só em E2E com falha injetada).
- Dados reais de conta Mercado Livre (ensaio sintético).
- Apresentação C2 completa (figura SVG do design não existe no repositório; mantidos cartões e tokens).

### Pontos a confirmar
- Full e estoque: referência C2 atribui ao Analista; Diretiva atribui ao Mix Ativo (Anúncios).
- Cartão de margem continua a somar todas as contas quando nenhuma é escolhida.

### Próximo gate
Revisão humana do Draft PR #14. Nenhum merge, deploy ou migração em produção.

## Checkpoint 23 — primeiro agente operacional: Central Farma (2026-11-21)

Branch: `feature/office-agents-mvp` (a partir de `integration/pr12-main-reconciliation` @ `d9ba6f2`). Draft PR contra a branch de integração. Não está em produção.

### Auditoria antes de implementar
- `/escritorio` mostrava estados fixos ("offline") e, na versão anterior, "Ativo"/"Bloqueado" sem execução. Substituídos por estados vindos da API.
- Nomes de produto: a Diretiva usa Central Farma, Dose Certa, Mix Ativo, Vitrine Farma, Giro Ads e Balcão Digital. A referência e a UI anterior usavam Gestor, Analista, Anúncios, Criativo, ADS e SAC. Adotados os nomes da Diretiva; divergência registada em `docs/agentes-escritorio.md`.
- `.claude/agents/` são subagentes de desenvolvimento, não agentes do produto.
- Serviços reutilizados: `MarginService` (`preview`, `alerts`, `feeChanges`), `product_costs` APPROVED, `margin_rules`, contas ML. Nenhum serviço financeiro foi recriado.

### Entregue
- Tabela `agent_runs` (migração `20261128_agent_runs`, aditiva, RLS, grant) e enum de estado. Sem desvio de schema nesta tabela.
- `central-farma-analysis.ts`: função pura; bloqueios `CONTA_DESCONECTADA`, `SEM_PEDIDOS`, `SEM_CUSTOS_APROVADOS`; achados com severidade; recomendações ligadas a achados; fontes com contagens; premissas (não é DRE).
- `agents.service.ts`: valida conta do tenant (404 se não for), grava `RUNNING`, lê dados, grava estado final ou `FAILED` com mensagem genérica.
- API: `GET /agents`, `POST /agents/:key/runs`, `GET /agents/runs`, `GET /agents/runs/:id`.
- Web: `/escritorio` com estados reais; painel para executar; `/escritorio/execucoes/[id]` com resultado, achados, recomendações, fontes, premissas e histórico.
- Arquitetura: `docs/agentes-escritorio.md`. Decisão: ADR-018.

### Evidências
- Commits: `c68268a` (API, migração, testes), `61458e9` (web).
- Testes em HEAD: API 58 suítes, 435 passam (1 ignorado); web 9 passam; E2E PostgreSQL real 12 suítes, 59 passam.
- Mutação: removido o filtro por tenant na validação da conta. O teste "conta de outro tenant" falhou. Código restaurado.
- Migração: base migrada do zero; diff do `agent_runs` contra o schema vazio após alinhar nomes de restrições ao padrão Prisma. O diff restante (`margin_rules` e outras) já existia antes deste trabalho e não foi alterado.
- Build: `nest build` e `next build` com código 0. Imagens `farmaecon-api:61458e9-agents` e `farmaecon-web:61458e9-agents`.
- Ensaio (não produção): backup `/opt/farmaecon/backups/pre-agents-rehearsal-20261121-141151`. Migração `20261128` aplicada, health `OBSERVATION`, `/agents` sem token → 401.
- Browser (ensaio, ADMIN de teste, dados sintéticos): `/escritorio` mostra Central Farma "Nunca executado" antes e "Concluído" depois; Dose Certa e demais "Ainda não implementado"; sem "Offline" fabricado. Execução sobre a conta "Loja pipeline": 2 SKUs analisados, 2 com margem calculável, 1 abaixo do limite (SKU ML-B, 28,0% contra 40,0%), receita R$ 200,00, fontes `orders` 2, `product_costs` 2, `margin_rules` 1.

### Ainda não comprovado
- O caminho `BLOCKED` não foi exercido no browser; está coberto por E2E e unitários.
- Papel OPERATOR no fluxo de execução não foi testado no browser (a regra é: qualquer utilizador autenticado do tenant pode executar a análise de leitura).
- Dados do ensaio são sintéticos. Não houve sincronização nem comparação com uma conta real do Mercado Livre.
- Execução síncrona: sem fila; uma interrupção pode deixar `RUNNING` sem fecho.

### Observações
- O cartão "Margem por SKU" conta alertas de todas as contas do tenant; a execução é por conta. No ensaio: cartão 2, execução 1. Não é erro, mas pode confundir.
- Na conta de seed `acc-westack` do ensaio o id não é UUID; a API recusa esse id com "accountId must be a UUID". Em produção os ids são gerados pelo Prisma como UUID.

### Próximo gate
1. Revisão humana do Draft PR.
2. Só depois, avaliar Dose Certa (DRE) quando houver reconciliação de liquidações.
3. Qualquer agente com ação real exige gate próprio (autorização comercial pré-definida e modo recomendação antes de ação).

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
