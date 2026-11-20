# Contexto do Projeto — Farmaecon Pro

## Repositório
- Caminho local: /root/Farmaecon-Pro
- Remote: https://github.com/marcelcostapt-cmyk/Farmaecon-Pro.git
- Branch atual: feature/merge-ml-resumable-sync
- Sessão de trabalho: `tmux attach -t farmaecon`

## Ambiente de produção (VPS srv1975247)
- Pasta de deploy: /opt/farmaecon (não tem .git — só deploy/runtime)
- Containers: farmaecon-api-1, farmaecon-web-1, farmaecon-db-1, farmaecon-redis-1 (+ traefik-traefik-1)
- Compose: docker-compose.prod.yml + docker-compose.vps.yml, env em .local/production.env
- Recursos: 2 vCPU, 7,8 GB RAM, sem swap, sem GPU — não instalar ferramentas pesadas (ex.: Ollama) aqui.

### Comando de deploy/rollback da API (o `docker compose up` sem -f/--env-file FALHA)
```bash
/opt/farmaecon/scripts/checkpoint.sh
cd /opt/farmaecon && docker compose -p farmaecon -f docker-compose.prod.yml -f docker-compose.vps.yml \
  --env-file .local/production.env up -d --no-build api
/opt/farmaecon/scripts/checkpoint.sh
```
Nota: `up api` corre antes o serviço `migrate` (mesma imagem da API).

### Checkpoints
- Script: /opt/farmaecon/scripts/checkpoint.sh → acrescenta a /opt/farmaecon/deploy.log (imagens, nº de orders, containers).

## Estado atual — deploy do scheduler CONCLUÍDO (2026-11-14 19:30 UTC)
- API: farmaecon-api:e33588e-scheduler-20261114-164657
  (sha256:1ef8393fc870b77dbde0cb222741577abbc0d11a63d2758c257b401c5f561468; 1,97 GB em disco / 388 MB conteúdo)
  — deploy às 19:10 UTC, healthy, 0 restarts. Commit e33588e, sem migrations novas face a f69965b.
- Web: farmaecon-web:f69965b-20261114-153937 (sha256:0cb5f711498fd4ec80a264b1c98b955f0c8ed27215fc21035a60d731fd3ba49e) — inalterada.
- Scheduler: 5 contas Mercado Livre (tenant eb5f0f20…) com BullMQ job scheduler `orders-sync-<accountId>`, a cada 15 min:
  893285ca, 930788df, 2dd33686, 3fb4ba8a, b018bd8f.
  - Registados via sync manual (job `sync-account-orders`) às 19:13–19:15 UTC.
  - Primeiros ticks automáticos 19:28–19:30 UTC: todos SYNCED, 0 jobs falhados, sem erros nos logs.
  - Próximos ticks ~19:43–19:45 UTC (depois a cada 15 min).
  - O schedule só é criado quando um sync de conta completa (não no arranque da API).
- Orders: baseline 10.119 → 10.128 (+9 nos syncs manuais); ticks automáticos sem alteração (reimportam por upsert).
- Tokens ML: válidos 2–4h às 19:30 UTC; fila `token-refresh` com 11 refreshes agendados, 0 falhados.

### Backup / rollback do deploy do scheduler
- Pasta: /opt/farmaecon/backups/pre-scheduler-20261114-165031/ (NÃO …165019, que não existe)
  - farmaecon_db-pre-scheduler.dump (437 KB, pg_restore -l OK)
  - SHA256SUMS (verificar com `cd <pasta> && sha256sum -c SHA256SUMS`)
  - production.env.bak (env antes do deploy) e ROLLBACK_IMAGES (API/WEB f69965b-20261114-153937)
- Rollback da API: `cp -p <pasta>/production.env.bak /opt/farmaecon/.local/production.env` + comando de deploy acima.
- Remover schedules: `queue.removeJobScheduler('orders-sync-<accountId>')` para as 5 contas.

## Ambiente de ensaio
- Projeto: farmaecon-rehearsal-teste
- Compose: /opt/farmaecon/docker-compose.rehearsal.yml
- API: http://127.0.0.1:13001/api/v1/health
- Web: http://127.0.0.1:13000
- Estado (2026-11-14 19:48 UTC): ATUALIZADO para as imagens de produção — API/migrate farmaecon-api:e33588e-scheduler-20261114-164657,
  Web farmaecon-web:f69965b-20261114-153937. Health/ready/web 200, 9/9 migrations. MARKETPLACE_SOURCE=MOCK (sem chamadas reais ao ML).
- Imagens estão fixas no próprio compose (sem env file) — atualizar com sed nas linhas `image:`.
- A migration 20261008_tenant_rls_environment_parity foi marcada com `migrate resolve --applied` (como em produção),
  porque o seu SQL é igual ao de 20260921_tenant_rls e falharia com "policy already exists".
- Backup antes da atualização: /opt/farmaecon/backups/pre-rehearsal-update-20261114-194739/
  (dump da BD do ensaio — vazia: 0 orders/users/contas —, compose .bak, ROLLBACK_IMAGES, SHA256SUMS).

## Gestão de contas ML em /integrations (branch feature/integrations-account-management — NÃO em produção)
- Spec: docs/superpowers/specs/2026-11-14-integrations-account-management-design.md · Plano: docs/superpowers/plans/2026-11-14-integrations-account-management.md
- Estado da conta = `status` (ACTIVE/WARNING/DISCONNECTED); não existe `isConnected`. ≠ ACTIVE não sincroniza nem renova tokens.
- Desconectar apaga tokens (null), põe DISCONNECTED, remove o scheduler e os jobs pendentes de `token-refresh`.
- `name` = identificador técnico `ML #<sellerId>`; `displayName` (nullable, ≤60 chars, vazio → null) é o nome amigável; UI mostra `displayName ?? name`.
- Reconectar: `POST /integrations/:id/reconnect` grava `oauth_states.expected_account_id`; o callback exige o mesmo `externalSellerId`
  (senão 409 `SELLER_MISMATCH`, nada escrito; web → `/integrations?error=seller_mismatch`).
- Remover: `DELETE /integrations/:id` = hard delete só com DISCONNECTED + 0 pedidos + 0 jobs pendentes (orders tem ON DELETE CASCADE!).
- Ações de gestão só ADMIN; sincronizar aberto a todos. `GET /integrations/ml/config` diz se o OAuth/PKCE está disponível.
- Web: componentes cliente → route handlers JSON (`apps/web/src/app/api/integrations/api-bridge.ts`); sem Server Actions novas.
  A web é Next 16 / React 19 (params de route handlers são Promise; `proxy.ts` na raiz é o middleware — não usar esse nome noutros sítios).
- Migration `20261114_integrations_account_management` (aditiva: display_name, expected_account_id).
- Revisão final: subagente Opus → 2 importantes corrigidos (timeout no nextRunAt; remove verifica deleteMany.count). 6 menores adiados no ledger.
- VALIDADO NO ENSAIO (2026-11-14 ~20:37 UTC) com farmaecon-api/web:integrations-a63fd93-20261114: migration aplicada (10/10),
  endpoints exercitados contra Postgres real com RLS — ml/config=SIMULATED_SOURCE, listagem só do próprio tenant (+displayName/nextSyncAt),
  rename (trim/null), disconnect (tokens null + DISCONNECTED), delete 409 (NOT_DISCONNECTED/HAS_ORDERS), cross-tenant 404, OPERATOR 403.
  Dados de teste limpos; ensaio de volta à base vazia, agora a correr a imagem do branch. OAuth real não testável (MOCK).
  Backup pré-validação: /opt/farmaecon/backups/pre-rehearsal-integrations-20261114-203158/
- Revisão TypeScript (estilo Pocock) aplicada: 0 `any`/casts forçados no diff; corrigido bug de edição (Enter) + retornos explícitos.
  DECISÕES DE DESIGN (recusadas de propósito, não reabrir sem motivo): mantém class-validator (não Zod — evita dep nova);
  state OAuth continua opaco + lookup na BD (NÃO decodificar tenantId/accountId do state — seria regressão de segurança);
  erros via ConflictException/NotFoundException (sem filtro global); display_name é TEXT + check de 60 code points (não varchar);
  DELETE devolve 200 {removed:true} (envelope `ok()` consistente, não 204); AccountCard é self-contained (page é Server Component).

## DRE inc 1 — importação de custos (branch feature/dre-increment-1, NÃO em produção)
- Pipeline extração→normalização→modelo→prévia (commits 04f5e86, dcff5c2, ed02321) + expansão catálogo/bonificação (caec5e0, d339d1f, bonus-calc, fa866a9, 24a1873). Suite 196/196, tsc limpo. Sem deploy.
- Parser XML (`nfe-xml-parser.ts`): extrai vNF(fiscalTotal)/vProd/vDesc/vOutro, fatura vOrig (cobr/fat) distinta do vNF, por linha ncm/uCom/vDesc/vOutro/unitCostPaid/lots. Deteta bonificação por CFOP 5910, texto FORNEC BONIFIC, fatura≠NF-e e vItem AUSENTE (tag) com vProd>0. `bonusAmount`=Σ vProd bonific.; `paidAmount`=fiscal−bonus. vItem PRESENTE=0,00 usa vProd com aviso (NÃO é bonificação).
- `bonus-calc.ts`: para grupos (EAN/cProd) com bonificação, 3 regras CANDIDATAS com fórmula legível e `status: 'estimado / pendente de aprovação'` — `rateio_proporcional_valor_nominal` (pago+bonificado ÷ unidades), `bonificacao_dilui_custo` (pago ÷ unidades), `bonificacao_sem_custo` (pago ÷ só pagas; bonificadas indisponível). NUNCA custo zero: sem base paga → `null`.
- ⚠️ INCONSISTÊNCIA NA SPEC do utilizador: secção F (fórmula geral) usa "pago+despesas"; secção H (exemplo 1926966) usa "pago+bonificado". É exatamente a decisão de negócio #2 — NÃO resolvida; os 3 candidatos ficam lado a lado para o utilizador escolher.
- Modelo (migrations 20261114_dre_purchase_documents + 20261115_dre_bonus_and_fiscal_fields): purchase_invoices / purchase_invoice_items / cost_allocation_rules / product_costs, NUMERIC/Decimal, RLS por tenant (filhas verificam posse do documento), CHECK: custo APROVADO exige regra de rateio; +has_bonus/bonus_amount/paid_amount/discounts e is_bonus/paid_quantity/bonus_quantity/ncm/unit/… Boot RLS check 10→14 tabelas. Idempotência (tenant, sha256).
- Endpoint `POST /dre/purchase-documents/preview` (AuthGuard jwt, FileInterceptor 10MB, XML/PDF/XLSX): devolve estrutura normalizada + hash + totais + bonusCalculations + extractionWarnings. NÃO grava nada.
- Catálogo de evidências: 10 documentos descritos pelo utilizador. ⚠️ PRIVACIDADE: os XMLs reais contêm CNPJs/endereços/valores reais — NÃO versionar originais. Fixtures em `apps/api/test/fixtures/nfe-*.xml` são SANITIZADAS (CNPJs/nomes/chaves fictícios) e reproduzem só estrutura+valores documentados. Os ficheiros reais NÃO estão no disco (verificado) → validação byte-a-byte PENDENTE.
- 7 DECISÕES DE NEGÓCIO BLOQUEIAM publicação de custos (NÃO resolver sem o Marcio): (1) doc→conta ML; (2) regra de bonificação (1926966/1885505); (3) tratamento vOutro; (4) vProd bruto vs vItem líquido com desconto; (5) vigência planilha ML GERAL; (6) código fornecedor 5080↔SKU; (7) quantidade "dd" de abril. Até lá: tudo `extracted/pending_review`, sem CMV final, sem deploy.
- CMV/DRE preview (commits 0992575, 6f72daf, d4b89d3): matching puro `resolveCostCandidate` (EAN→SKU→cod.fornecedor→descrição normalizada; mais recente antes da venda; origem doc/linha/hash), `computeOrderCmvPreview` (1 candidato→indicativo; vários→null; sem match→indisponível), `computeDrePreview` (day/month/product; total indicativo só sem ambíguos/indisponíveis; range min/max). Persistência `PurchaseInvoiceService.ingest` em PENDING_REVIEW (idempotente tenant+sha256, isolado; NUNCA product_costs). Endpoints: `GET /dre/orders/:id/cmv-preview`, `GET /dre/preview` (account/período/group_by), `POST /dre/purchase-documents` (ADMIN ingest). Pool vem de purchase_invoice_items pending_review (`buildCostPoolFromDb` recalcula bonificação). order_items ML não têm EAN → matching por SKU/descrição. Período filtra por createdAt (import) como proxy; soldAt=mlDateCreated??createdAt. 219 testes, tsc limpo.
- Falta: UI `/dre/preview` (opcional, não feito), Task D (idempotência/isolamento e2e Postgres real — lógica coberta em memória), revisão final de branch (revisor fresco). product_costs/cost_allocation_rules continuam sem CRUD (regra de ouro: nada publicado sem regra aprovada).
- Bug report do incidente de containers: JÁ em fila (SendFeedback); envio pelo utilizador via /feedback. Regras kill/pt-BR em memória.

## DEPLOY VIA 1 EM PRODUÇÃO — CONCLUÍDO (2026-11-19 ~10:45 UTC)
- Produção atualizada para farmaecon-api/web:94612a9 (branch feature/westack-margin-manager): PR #9 (publicação manual de custos + bonificação + parsers NF-e) + ciclo WeStack (margem por SKU).
- Autorização explícita do Márcio/utilizador obtida no gate (AskUserQuestion "Deploy Via 1" → "Sim").
- production.env: SÓ as 2 tags (API_IMAGE/WEB_IMAGE → :94612a9); diff vazio fora delas (MARKETPLACE_MODE hardcoded OBSERVATION no compose, SOURCE/segredos/URLs intactos).
- Comando: `docker compose -p farmaecon -f docker-compose.prod.yml -f docker-compose.vps.yml --env-file .local/production.env up -d --no-build`. migrate usa API_IMAGE (não há MIGRATE_IMAGE).
- 7 migrations aditivas aplicadas (o prompt dizia 6): dre_order_items, dre_purchase_documents, integrations_account_management, add_account_fiscal_identity, dre_bonus_and_fiscal_fields, dre_allocated_bonus, westack_margin_rules. migrate PASS, boot RLS check 15 tabelas, Prisma conectado.
- Health: API {"status":"ok","mode":"OBSERVATION"}; web 200; público via traefik app.farmaecon.com.br / e /login 200, /margin/preview e /dre/preview 307→/login (auth, rotas existem). api/web restarts=0. orders 13.016 (inalterado). Scheduler de observação a sincronizar ML real (tick SYNCED pós-deploy).
- Backup pré-deploy: /opt/farmaecon/backups/pre-deploy-via1-20261119-103428/ (farmaecon_db.dump 548K + redis.rdb + production.env.bak + ROLLBACK_IMAGES {api e33588e-scheduler / web f69965b} + orders_count.txt=13016 + SHA256SUMS verificado).
- Rollback de código: repor tags do ROLLBACK_IMAGES em production.env + mesmo `up`. Rollback de schema NÃO é automático (migrations aditivas); restaurar BD do dump só com autorização explícita.
- MONITORAMENTO EM CURSO (janela 24h aberta; deploy ~10:45 UTC 2026-11-19 → fecho previsto ~11:13 UTC 2026-11-20). Monitorização PONTUAL (opção escolhida), não automática.
  - F#1 (~10:47 UTC): api/web healthy restarts=0; orders 13.016; bull:marketplace-sync:failed=19 — TODOS "ML API 429" e TODOS anteriores ao deploy (último ~07:49 UTC), transitórios, NÃO do deploy.
  - F#2 (11:13 UTC): healthy restarts=0; failed=19 (0 novos); orders 13.017 (+1, sync real a funcionar); sem erros novos.
  - F#3 (11:54 UTC): healthy restarts=0; failed=19 (0 novos; último ~07:49 UTC); token-refresh:failed=0; orders 13.017; logs só ticks SYNCED + refresh de token, sem 5xx/exceções.
  - FALTA: checkpoint final ~11:13 UTC de 2026-11-20 → se limpo, FECHAR janela.
- Nota de validação com dados reais em PRODUÇÃO: orders antigos não têm order_items (tabela nova; só populam em re-sync); custos não publicados (bloqueados pelas 7 decisões). Logo margem/DRE em prod ficam "indisponível" até re-sync popular items E custos serem publicados. Validação autenticada da UI em prod exige login real do Márcio (NÃO semear dados em produção).

### PIPELINE DRE→MARGEM VALIDADO PONTA-A-PONTA NO ENSAIO (2026-11-19 ~14:4x UTC, imagens 94612a9, MOCK)
- Prova pelos endpoints/UI deployados, com dados SINTÉTICOS (fixture apps/api/test/fixtures/nfe-bonificacao-sintetica.xml: produtos A cProd 5080/EAN …011 unit 10, B cProd 5081/EAN …022 unit 30, sem bonificação):
  1. POST /dre/purchase-documents/preview → 2 linhas, 0 candidatos de bonificação.
  2. POST /dre/purchase-documents (ingest) → pending_review; accountMatch=cnpj_no_match (requer revisão).
  3. POST :id/account → MATCHING doc↔conta a funcionar: RECUSOU por "CNPJ do destinatário difere do CNPJ da conta"; só vinculou após alinhar cnpj da conta ao dest da NF-e (00000000000272). (conta criada com UUID real; acc-westack do seed anterior não é UUID e falha o @IsUUID.)
  4. POST :id/bonus {hasBonus:false, rule:IGNORE} → custos por linha A=10, B=30.
  5. POST :id/publish {confirm:true} → 2 product_costs APPROVED (ZERO_BONUS), com cost_allocation_rule (ean+supplier_code+description; sku null pois a NF-e não traz SKU do ML).
- Margem a partir dos custos PUBLICADOS (match por descrição normalizada, pois orders não têm ean/supplier_code): semeadas 2 vendas (title=PRODUTO SINTETICO A/B). /margin/preview?account_id=<uuid>: A rev100−taxa8−CMV50=42 (42%), B 100−12−60=28 (28%); /margin/alerts: B 28%<40%. UI /margin/preview confirma (screenshots). Liga DRE + matching fiscal + margem por SKU.
- RESSALVA: valida só a MECÂNICA com dados sintéticos; as 7 decisões de negócio continuam a bloquear a publicação de custos REAIS (em produção). Nenhuma chamada ao ML.
- Dados do pipeline ficaram no ensaio (conta a2607821…, 2 vendas, 2 custos); repor com /opt/farmaecon/backups/pre-ui-rehearsal-20261119-101052 se quiser base limpa.

## Pendências / próximos passos
- Monitorizar nas próximas horas: jobs falhados em bull:marketplace-sync, acumulação na fila, erros ML/tokens
  (1º refresh de token relevante: conta 3fb4ba8a expira ~21:47 UTC de 2026-11-14).
  ✅ VERIFICADO 21:50 UTC: refresh do 3fb4ba8a OK (expires_at → 03:17), token-refresh failed=0, 6 contas SYNCED, marketplace-sync failed=0, API healthy restarts=0, orders=10143.
  ✅ VALIDAÇÃO OBSERVATION (22:0x UTC): 6 contas reais (sellers 202152082/2919086523/2412166681/1354653882/1155197715/3750471879), todas COMPLETE, last_error vazio.
     Sem duplicação (count==distinct external_order_id) nas 2 amostras (0072890c=8, b018bd8f=4554). Cobertura contínua (sem dias a zero). Orders=10143 (9771 PAID, 372 CANCELED).
     Ressalva de dados: orders NÃO guarda data do pedido no ML (só created_at=importação) → comparação manual com painel ML é por external_order_id+valor+estado, não por data.
     financial_transactions=0 (DRE não deriva transações). Modo mantém-se OBSERVATION (só leitura garantida por assertObservationRequest).
  🔎 INVESTIGADO financial_transactions=0: POR DESIGN, não bug. Única escrita = FinanceService.createExpense (type EXPENSE, POST manual /finance/expenses); nenhuma derivação order→REVENUE/FEE/etc existe.
     getDre devolve status INCOMPLETE, grossRevenue/fees/costs=null, grossProfit/netProfit=null — recusa tratar total_amount como receita sem reconciliação.
     DRE real seria FEATURE NOVA: orders só guarda total_amount+status (sem fees/payments do ML) → precisaria sincronizar mais campos + derivação + reconciliação. Não bloqueia o sync em observação.
- Reparo menor no scheduler: o 1º tick dispara logo após o registo (2 passagens seguidas à API ML).
- Limpeza possível de imagens antigas sem uso (api:58dede46, web:oauth-redirect-…) — confirmar antes.
- Ollama: adiado; se necessário, instalar localmente, não na VPS.
- Ressalvas pré-deploy antigas: tamanho da imagem API reduzido (2,98 → 1,97 GB); Server Action ainda por rever.

## Diagnóstico de conclusão (2026-11-14, branch de trabalho security/next-bump-16-4-x)
Estado por dimensão:
- Código/arquitetura 🟢: 9 módulos (auth, dashboard, finance, integrations, observation, orders, products, tenants, users), 0 TODO/FIXME, 138 testes verdes, sem simulação ativa em prod. Dívida: branches obsoletos por limpar, `main` desatualizado (0de434).
- Integrações 🟢 ML / 🔴 resto: ML OAuth+refresh+sync em OBSERVATION (6 contas reais, 0 falhados). NF-e parser e gateways NÃO existem (desenhados no inc 1 do DRE).
- Dados/relatórios 🟡: observação entrega valor; DRE gerencial com lucro real NÃO existe (financial_transactions=0 por design); custos não importados; receita/taxas ML vêm no /orders/search mas não persistidas.
- Infra/deploy 🟡: CI abrangente, deploy+rollback documentados e testados; FALTA fixar imagens por digest, Dockerfile API produção-only (envia devDeps), testar restore BD end-to-end.
- Segurança 🟡: RLS validada, tokens cifrados (AES-256-GCM), SSL Let's Encrypt OK; GAPS: UFW inativo, sem swap, 62 vulns npm (2 críticas, maioria dev; crítica do Next já corrigida), retenção LGPD por definir.
- Testes 🟢 backend / 🟡 resto: 138 testes + CI; e2e Postgres não corre aqui (falta .local/observation.env), sem testes web, smoke pós-deploy não formalizado.

Top 3 bloqueios: (1) DRE gerencial não existe (só desenhado, inc 1 pendente de aprovação); (2) dados financeiros do ML não persistidos; (3) hardening infra/segurança.
Top 5 passos: (1) aprovar+executar inc 1 do DRE; (2) hardening rápido (UFW+swap+imagem produção-only); (3) fechar ciclo Git (PR #6, branches, main); (4) testar restore BD; (5) triar vulns + digests.
Perguntas p/ Marcio: operação real = observação+DRE ou modo ativo? custo por conta vs empresa (resolvi por conta)? prioridade DRE vs infra? alinhar main? alargar allowlist (ADS/billing) no inc 2?

## Deploy do PR #9 — ADIADO (Via 3) · 2026-11-18
- PR #9 MERGED em feature/merge-ml-resumable-sync (commit 36d9675). NÃO houve deploy em produção.
- Produção intocada: MARKETPLACE_MODE=OBSERVATION (nem está no env → default), SOURCE=MERCADO_LIVRE, imagens api e33588e-scheduler / web f69965b inalteradas. Migrations de produção em 20261011 (6 pendentes NÃO aplicadas).
- Motivo: sem autorização explícita do Márcio para a Via 1. A "via limpa" (só migrations do PR #9) é INVIÁVEL: o auto-vínculo por CNPJ do PR #9 lê cnpj/businessName (migration fiscal-identity) e o código de integrations lê display_name (migration integrations-management) — não dá para aplicar só as do DRE sem partir a app.
- GATE p/ Márcio: escolher Via 1 (aplicar as 6 migrations aditivas, já validadas no ensaio, deploy completo), Via 2 (reverter integrations-management+fiscal-identity e revalidar — é dev, não deploy) ou Via 3 (manter em ensaio). Via 1 é a única que entrega a publicação de custos em produção.

## Ciclo WeStack — Gestor de Margem por SKU (branch feature/westack-margin-manager, só leitura) · 2026-11-18
- DESCOBERTA que reduz o âmbito do prompt: os campos financeiros do ML JÁ são modelados e persistidos — OrderItem.saleFee ← ML sale_fee, grossPrice, unitPrice, quantity; Order.paidAmount ← paid_amount; Order.mlPaymentsRaw ← payments (JSON). Logo NÃO é preciso migration/sync novos para "persistir fees" (passo do prompt já está feito no branch merge-ml).
- Já existe DrePreviewService + computeDrePreview que calcula receita, CMV (de product_costs APPROVED) e margem BRUTA (receita−CMV). O delta WeStack é: margem LÍQUIDA (receita − taxas ML saleFee − CMV) + limites configuráveis por tenant (margin_rules) + alertas. Reutiliza cost-matching existente; nunca fabrica número (indisponível se falta custo/taxa).
- Ressalva de validação: produção (20261011) ainda não tem order_items (migração não deployada); ensaio tem o schema mas 0 orders (MOCK). Validação de margem com dados reais só após deploy; entretanto valida-se com dados sintéticos no ensaio (como no PR #9).

### FEITO (2026-11-18, commits 6d04ba5 · 8ba0740 · 5dbca11 · b04cd81; SEM deploy — Via 3 mantém-se)
- Núcleo puro `costs/margin-calc.ts` (computeMargin: receita−taxas−CMV; indisponível se falta taxa/custo ou custo≠approved; % null se receita 0; isBelowRule) e `costs/margin-preview.ts` (agrega por sku/dia/mês, alertas por regra; reusa resolveCostCandidate). 18 testes unitários.
- Módulo `margin/`: MarginService (pool = product_costs APPROVED; rows = orders+order_items; taxa = saleFee) + MarginController (AuthGuard jwt): GET /margin/preview, /margin/alerts, /margin/rules; PUT /margin/rules (ADMIN, exige ≥1 limite). Só leitura sobre o ML; nunca escreve lá.
- Migration aditiva `20261118_westack_margin_rules` (margin_rules: sku nullable=regra global, min_margin_percent/amount, RLS por tenant + grants). Boot RLS check 14→15 tabelas.
- BUG encontrado e corrigido via e2e: margin_rules não estava no conjunto `models` do PrismaService → acessos fora da transação por tenant → RLS negava tudo (alertas vazios; escritas sem contexto). Corrigido (5dbca11). LIÇÃO: todo modelo novo com RLS por tenant TEM de entrar no Set `models` de prisma.service.ts.
- Web: página `/margin/preview` (Server Component, resumo + alertas + detalhe por SKU), card de resumo no escritório, item na navegação. Nenhuma Server Action nova; nenhuma ação comercial.
- Verde: 325 unit (api) + 30 e2e em PostgreSQL REAL (`npm run test:postgres`, farmaecon_runtime; margem líquida, indisponível sem taxa, alerta <limite, isolamento entre tenants + migration/boot check 15) + build api + build web. Revisão final: auto-revisão do diff (sem subagente, por não ter sido pedido); 1 menor adiado (índice único (tenant_id, sku) trata sku NULL como distinto — guardado por findFirst+create no upsertRule, sem impacto funcional).
- PENDENTE: validação de margem com DADOS REAIS só após deploy em produção (order_items não deployados); até lá só sintético. Deploy continua a depender do gate do Márcio (Via 1/2/3).
- Infra de teste descartável (farmaecon-e2e-pg/redis) e `.local/observation.env` são locais e efémeros (env ignorada pelo git); recriar PG+env para voltar a correr `test:postgres`.

### VALIDADO NO ENSAIO (2026-11-19 ~10:10 UTC) — imagens farmaecon-api/web:94612a9
- Build das imagens api(2,17 GB)/web(337 MB) do HEAD 94612a9; compose do ensaio atualizado (sed nas linhas image:, b8146aa→94612a9); deploy `docker compose -f docker-compose.rehearsal.yml up -d` (projeto farmaecon-rehearsal-teste). migrate PASS (migration margin_rules aplicada, boot RLS check 15), api/web healthy, /api/v1/health 200, web 200.
- Backup pré-deploy: /opt/farmaecon/backups/pre-ui-rehearsal-20261119-101052/ (rehearsal.dump 64K + redis.rdb + compose.bak + SHA256SUMS).
- Seed SINTÉTICO (owner, bypassa RLS; dados fictícios): tenant ensaio-westack, admin-westack@ensaio.local (ADMIN), conta ML #ensaio, 2 custos APPROVED (DIPIRONA 30, PARACETAMOL 20), 3 vendas (saleFee 10/5/null), regra global 40%.
- Endpoints (JWT real): /margin/preview → DIPIRONA 100/10/60/30 (30%) disp., PARACETAMOL 50/5/20/25 (50%) disp., SEMTAXA indisponível (taxa/custo null); totais receita 190, 2 disp./1 indisp. /margin/alerts → só DIPIRONA (30%<40%). /integrations → 1 conta.
- Browser (Playwright, screenshots): /escritorio mostra card "📈 Margem por SKU" (1 abaixo do limite, 40.0% média, ver detalhe→); /dre/preview carrega o formulário de importação (ADMIN) com a conta disponível; /margin/preview mostra resumo+alerta+tabela corretos. Nenhuma chamada ao ML (MOCK/OBSERVATION).
- PRODUÇÃO INTACTA: api-1 e33588e-scheduler / web-1 f69965b (Up, não recriados); .local/production.env inalterado. Deploy a produção continua a depender do gate do Márcio (Via 1).
- Dados sintéticos ficaram no ensaio para inspeção manual; repor base com o backup acima se necessário.

## Frontend /escritorio — Direção C2 aplicada (branch feature/frontend-escritorio-direcao-c, NÃO em produção) · 2026-11-19
- Pedido era "Direção C1 (Palco claro)" do Figma, mas o Figma não é acessível e o repo só tem o sistema C2 ("Estações no balcão", bloqueado 2026-11-14 em docs/design/design-system.md + tokens.css). O utilizador escolheu (opção 1) aplicar o C2 existente. NÃO inventar C1.
- Só pacote web; sem backend/deploy/produção. Tokens --fa-* adicionados a apps/web/src/app/globals.css (:root + .fa-num tabular-nums). Restilizados: layout.tsx (sidebar navy, nav/hover, chip "Modo Observação" laranja #FFF4EC + ponto, header, palco claro --fa-bg no main), escritorio/page.tsx (h1 navy 28, chip), components/escritorio/{StatusBadge (pares fa-st-*/financeiros: ponto+texto), OfficeScene, AgentStatusList, MargemResumoCard (KPI 30 + tabular-nums; nº abaixo do limite em --fa-neg se >0)}.
- Verde: npm run build --workspace web OK. Screenshots antes (/tmp .../ui-escritorio.png) e depois desktop+tablet (ui-escritorio-after*.png); responsividade desktop 1280 + tablet 820 OK.
- Validação visual feita com imagem farmaecon-web:escritorio-c2 trocada temporariamente no ensaio e REVERTIDA para 94612a9 (ensaio de volta ao estado validado, web healthy). Nada tocou produção.
- Nota: a sidebar é o shell partilhado → o navy/laranja aparece em TODAS as páginas do dashboard (consistente com o sistema, por design). Falta eventual: estado "ativo" por rota (precisa de client nav) não implementado.

## Heróis e vilões por margem (GET /margin/ranking) · 2026-11-20 (branch feature/westack-margin-manager, só leitura, NÃO em produção)
- FEITO: `costs/margin-ranking.ts` (puro) — heróis = maior margem % com margem positiva; vilões = menor margem % do que sobra; indisponíveis ficam de fora e são contados. Endpoint `GET /margin/ranking` (account_id/start_date/end_date) reusa o cálculo do preview. Sem UI.
- Verde: tsc limpo; 357 unit (6 novos em margin-ranking.spec.ts); 35 e2e em PostgreSQL real (`npm run test:postgres`, incl. ranking e isolamento por tenant).
- LIÇÃO: `npm run lint --workspace=api` corre `eslint --fix` sobre todo o src/test e reformata ~113 ficheiros; NÃO o correr para validar. O estilo commitado é mais largo que o do lint.
- Infra de teste descartável: containers `farmaecon-e2e-pg` (127.0.0.1:55432) e `farmaecon-e2e-redis` (127.0.0.1:6379), criados para o e2e; remover quando não forem precisos.
- UI FEITA: secção "Melhores/Piores margens" em /margin/preview (Server Component, `GET /margin/ranking`, sem Server Action). `tsc` e `build web` OK. Não validado no browser nem em ensaio (imagem da API precisa do endpoint novo).
- PRÓXIMO: (b) UI de regras por SKU (formulário cliente → route handler PUT /margin/rules, via api-bridge); depois (c) alerta de mudança de tarifa ML. Ensaio com imagens novas só quando (b) estiver pronto.
- BLOQUEIO: nenhum; a margem real em produção continua dependente das 7 decisões de negócio.
- DECISÕES do protocolo autónomo: registadas em /tmp/farmaecon-decision.log (ordem: UI ranking antes de regras por SKU, por ser só leitura).
