# DRE gerencial — Incremento 1 (itens de pedido + custos + CMV) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir os itens vendidos (que o `/orders/search` já devolve), importar custos de produto (Excel/XML-NFe/PDF) com histórico versionado por conta, e calcular o CMV por pedido/período com cobertura explícita (custo em falta → pendente, nunca zero).

**Architecture:** Migrations aditivas Prisma (colunas NUMERIC novas, Float legado intacto). Estender o sync windowed existente para gravar `order_items` + campos financeiros do pedido; backfill idempotente dos pedidos históricos. Pipeline de importação (NestJS) com parsers Excel/XML/PDF, prévia e confirmação. Cálculo de CMV determinístico por versão de custo válida na data da venda. UI em Next (Produtos e custos) com o sistema visual bloqueado.

**Tech Stack:** NestJS 10, Prisma 7 (Postgres, RLS por tenant, Decimal/NUMERIC), BullMQ; parsers: `exceljs`, `fast-xml-parser` (XXE off), `pdf-parse` + `tesseract.js` (OCR, lazy); Next 16 / React 19; Jest.

**Spec:** `docs/superpowers/specs/2026-11-14-dre-increment-1-design.md`

## Global Constraints
- Migrations **só aditivas**; `Float` legado (`total_amount`, `cost_price`, …) **nunca** convertido in-place; colunas financeiras novas em **NUMERIC** (Prisma `Decimal`).
- Isolamento por **tenant (empresa) + conta**: toda query filtra `tenantId`; custo e CMV filtram também `marketplaceAccountId`. A seleção de conta no frontend **não** é autorização — posse validada no backend.
- Modo **OBSERVATION** intocado; sem endpoints novos do ML; o incremento 1 usa só o que `/orders/search` já devolve (confirmado na captura: `order_items[]` com `element_id`, `seller_sku`, `quantity`, `unit_price`, `sale_fee`; `payments[]`; `date_created`; `pack_id`).
- `ml_element_id` = `order_items[].element_id`; chave única de linha `(tenant_id, order_id, ml_element_id)`.
- **Custo em falta → pendente, nunca zero.** CMV do pedido completo só se todas as linhas têm custo. Subtotal de pedidos completos nunca apresentado como resultado da conta inteira.
- `effective_from` obrigatório na importação (pré-preenchido pela emissão da NF-e no XML; nunca fallback silencioso de upload). Seleção de versão compara a data-calendário local da venda (fuso da conta, America/Sao_Paulo).
- Dinheiro com decimais exatos; arredondamento explícito só na totalização; cêntimos preservados no rateio de kits.
- Sem novas Server Actions; parsers tratam ficheiros como **dados** (XXE/DTD off, sem macros).
- O scheduler de 15 min e o sync existente continuam a funcionar.
- Sem deploy/migração em produção sem OK explícito; trabalho em branch isolado.

## Review Focus
1. **Mesma NF-e em XML e em PDF** → uma só compra (dedup por `document_key`, não só por `file_hash`). *(Task 7)*
2. **Pedido multi-item com SKUs repetidos / kit** → `element_id` distingue linhas; upsert não colide nem duplica no backfill. *(Tasks 2, 3)*
3. **Duas contas (mesmo tenant), mesmo EAN, custos diferentes** → CMV isolado por conta. *(Task 8)*
4. **Atualização de custo** não altera o CMV de vendas fora da vigência. *(Task 8)*
5. **Redis/ML em baixo durante o backfill** → job resumível, não corrompe estado nem relê tudo; o sync de 15 min não é afetado. *(Task 3)*

---

## File Structure
**API (`apps/api`)**
- `prisma/schema.prisma` — `OrderItem`, colunas NUMERIC em `Order`, extensão de `Product`, `ProductCostVersion`, `KitComponent`, `ProductMlLink`, `CostImport`, `CostImportLine`.
- `prisma/migrations/<ts>_dre_order_items/…`, `<ts>_dre_products_costs/…`, `<ts>_dre_cost_imports/…` — aditivas.
- `src/modules/orders/order-item.mapper.ts` — extrai linhas+financeiro de um pedido ML.
- `src/modules/integrations/ml-orders-sync.service.ts` — persistir itens + campos financeiros.
- `src/modules/integrations/order-items-backfill.ts` + processor — recuperação histórica.
- `src/modules/costs/` (novo módulo): `cost-money.ts` (Decimal helpers), `cost-import.service.ts`, parsers `excel-parser.ts` / `nfe-xml-parser.ts` / `pdf-parser.ts`, `cost-association.service.ts`, `cost-version.service.ts`, `cmv.service.ts`, `costs.controller.ts`, `costs.module.ts`.
- `test/memory-prisma.ts` — novos modelos.
- Testes `*.spec.ts` por serviço + `dre-flow.spec.ts` (percurso).

**Web (`apps/web/src/app/(dashboard)`)**
- `produtos/` (nova rota "Produtos e custos"): página + wizard de importação (componentes cliente) + route handlers JSON em `app/api/costs/…`.
- Reutiliza `docs/design/tokens.css` + componentes do sistema visual.

---

### Task 1: Dinheiro decimal + modelo OrderItem (migration)
**Files:** `prisma/schema.prisma`; `prisma/migrations/<ts>_dre_order_items/migration.sql`; `src/modules/costs/cost-money.ts`; `test/memory-prisma.ts`; test `src/modules/costs/cost-money.spec.ts`.
**Interfaces:**
- Produces: `OrderItem { id, tenantId, marketplaceAccountId, orderId, mlItemId, mlElementId, sellerSkuRaw, title, categoryId, variationId, variationAttributes(Json), quantity(Int), unitPrice(Decimal), grossPrice(Decimal), saleFee(Decimal), listingTypeId, currencyId, productId? }`; `Order` ganha `paidAmount(Decimal?)`, `mlDateCreated(DateTime?)`, `mlDateClosed(DateTime?)`, `packId(String?)`, `statusDetail(String?)`, `mlPaymentsRaw(Json?)`. `money(value): Prisma.Decimal` e `sumCents(items): Prisma.Decimal` em `cost-money.ts`.
- [ ] Step 1 (RED): `cost-money.spec.ts` — `money('15.53')` iguala `new Prisma.Decimal('15.53')`; `sumCents([money('0.1'),money('0.2')])` === `money('0.3')` (sem erro de float).
- [ ] Step 2: correr → FAIL.
- [ ] Step 3: migration aditiva (OrderItem + colunas Order NUMERIC, nullable; índice `(tenant_id, order_id, ml_element_id)` único; RLS tenant + posse via order); schema; `cost-money.ts`; `deleteMany`/novos modelos no MemoryPrisma.
- [ ] Step 4: `npx prisma validate && npx prisma generate && npx jest cost-money` → PASS; `npm run typecheck` limpo.
- [ ] Step 5: commit `feat(db): OrderItem, campos financeiros do pedido e dinheiro decimal`.

### Task 2: Extrair e persistir itens no sync
**Files:** `src/modules/integrations/order-item.mapper.ts`; `ml-orders-sync.service.ts`; test `order-item.mapper.spec.ts` (usa a fixture sanitizada `scratchpad/orders-sample.sanitized.json` → copiar para `apps/api/test/fixtures/ml-order.json`).
**Interfaces:**
- Consumes: Task 1.
- Produces: `mapOrderItems(order: MlOrder, ctx): OrderItemInput[]` e `mapOrderFinance(order): OrderFinanceInput`; o sync faz `upsert` por `(tenantId, orderId, mlElementId)`.
- [ ] Step 1 (RED): `mapOrderItems` da fixture devolve 1 item com `mlElementId='1'`, `sellerSkuRaw='6 MARCADORES NEON'`, `quantity=1`, `unitPrice=money('15.53')`, `saleFee=money('1.79')`; distingue 2 itens de `element_id` diferentes; campo ausente → `null`, nunca `0`.
- [ ] Step 2: FAIL.
- [ ] Step 3: implementar mapper (distinguir ausente/null/zero) e, no `ml-orders-sync`, persistir itens + `mapOrderFinance` dentro da mesma transação/janela, idempotente.
- [ ] Step 4: `npx jest order-item ml-orders-sync resumable` → PASS (sync existente intacto).
- [ ] Step 5: commit `feat(integrations): persistir itens e financeiro do pedido no sync`.

### Task 3: Backfill histórico de itens
**Files:** `src/modules/integrations/order-items-backfill.ts` + processor na fila existente; test `order-items-backfill.spec.ts`.
**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `enqueueBackfill(accountId, tenantId)` e `runBackfillTick(job)` — relê janelas `/orders/search`, upsert idempotente, resumível, throttled; **separado** do scheduler de 15 min.
- [ ] Step 1 (RED): correr o backfill duas vezes sobre a mesma fixture não duplica `order_items` (count estável); uma falha a meio retoma sem relê tudo.
- [ ] Step 2: FAIL.
- [ ] Step 3: implementar reutilizando o mecanismo resumível; marca progresso por janela.
- [ ] Step 4: `npx jest order-items-backfill` → PASS.
- [ ] Step 5: commit `feat(integrations): backfill idempotente de itens históricos`.

### Task 4: Produto, versões de custo e kits (migration)
**Files:** `prisma/schema.prisma`; `prisma/migrations/<ts>_dre_products_costs/migration.sql`; test `src/modules/costs/cost-version.service.spec.ts`.
**Interfaces:**
- Produces: `Product` += `eanGtin?`, `unitOfSale?`, `presentation?`, `isKit`; `ProductCostVersion { id, tenantId, productId, marketplaceAccountId, unitCost(Decimal), method(IMPORTED_UNIT|LOT_WEIGHTED_AVG|MANUAL), effectiveFrom(Date), sourceKind, sourceDocumentId?, createdBy }`; `KitComponent { kitProductId, componentProductId, quantity }`; `ProductMlLink { tenantId, marketplaceAccountId, mlItemId?, sellerSku?, productId }`. `CostVersionService.costAt(productId, accountId, saleDate): Decimal | null` (versão com `effectiveFrom ≤ data local da venda`, a mais recente; kit → soma componentes; sem versão → `null`).
- [ ] Step 1 (RED): duas contas com o mesmo `eanGtin` e custos diferentes → `costAt` devolve o valor da **própria conta** (isolamento, Review #3); custo adicionado com `effectiveFrom` futura não afeta venda anterior (Review #4); kit = soma dos componentes × qtd.
- [ ] Step 2: FAIL.
- [ ] Step 3: migration aditiva + `CostVersionService` (comparação de data no fuso da conta).
- [ ] Step 4: `npx jest cost-version` → PASS.
- [ ] Step 5: commit `feat(costs): versões de custo por conta, vigência e kits`.

### Task 5: Importação Excel + lote/média + dedup base
**Files:** `src/modules/costs/cost-money.ts` (reuso); `excel-parser.ts`; `cost-import.service.ts`; `CostImport`/`CostImportLine` migration `<ts>_dre_cost_imports`; tests `excel-parser.spec.ts`, `cost-import.service.spec.ts`; fixtures `.xlsx` sintéticas.
**Interfaces:**
- Consumes: Task 4.
- Produces: `parseExcel(buffer, {sheet, mapping}): ParsedCostLine[]` (SKU/EAN como texto, zeros à esquerda; valida separador decimal/científica/linha inválida/unitário-vs-total; nunca executa fórmulas); `CostImportService.createDraft(file, meta): CostImport` (guarda original+`fileHash`+`documentKey`); `confirm(importId, lineIds)`; `lotWeightedAverage(lines): Decimal` (Σ custo aquisição / Σ unidades normalizadas, ponderada).
- [ ] Step 1 (RED): EAN `0007894900011` preservado como texto; `lotWeightedAverage` de 2 compras (10@2,00 e 30@3,00) = `2,75` (ponderada, não média simples 2,50); reenvio do **mesmo ficheiro** (`fileHash`) não cria segunda compra.
- [ ] Step 2: FAIL.
- [ ] Step 3: implementar `exceljs` (valores, não fórmulas) + serviço de import com prévia/confirmação e dedup por hash.
- [ ] Step 4: `npx jest excel-parser cost-import.service` → PASS.
- [ ] Step 5: commit `feat(costs): importação Excel com prévia, média de lote e dedup`.

### Task 6: Importação XML NF-e + PDF/OCR
**Files:** `nfe-xml-parser.ts`, `pdf-parser.ts`; tests + fixtures sintéticas (`nfe.xml`, `nfe.pdf`). *(Ficheiros reais citados ausentes → fixtures identificadas; validação documental real fica PENDENTE e registada.)*
**Interfaces:**
- Consumes: Tasks 4–5.
- Produces: `parseNfeXml(buffer): ParsedPurchase` (XXE/DTD off; extrai chave, CNPJ emitente/dest, itens `cProd`/`cEAN`/`uCom`/`qCom`/`vUnCom`/desconto/frete; `cProd` ≠ SKU vendedor; sinaliza divergência de CNPJ; trata cancelada/devolução); `parsePdf(buffer): ParsedPurchase & {confidence, pageRefs}` (texto; OCR tesseract lazy; ambíguo → pendente, nunca adivinhado).
- [ ] Step 1 (RED): XML com entidade externa **não** resolve (XXE bloqueado); `chave` e CNPJ extraídos; divergência de CNPJ sinalizada; PDF ilegível → linha `PENDING` com `pageRefs`, sem valor inventado.
- [ ] Step 2: FAIL.
- [ ] Step 3: implementar parsers; `documentKey` = chave da NF-e para dedup cross-formato.
- [ ] Step 4: `npx jest nfe-xml-parser pdf-parser` → PASS.
- [ ] Step 5: commit `feat(costs): importação XML NF-e (XXE off) e PDF/OCR`.

### Task 7: Associação + dedup cross-formato
**Files:** `cost-association.service.ts`; `cost-import.service.ts` (dedup por `documentKey`); tests.
**Interfaces:**
- Consumes: Tasks 5–6.
- Produces: `associate(line, accountId): {productId, method:'CONFIRMED'|'SKU'|'EAN'|'SUGGESTION'|'NONE'}` — ordem: vínculo confirmado → SKU exato → EAN exato (unidade/apresentação compatível, sem conflito) → sugestão por descrição (humana); **nunca** por nome parecido. Confirmar persiste `ProductMlLink`.
- [ ] Step 1 (RED): nomes parecidos / concentração diferente **não** associam automaticamente; SKU exato associa; **a mesma NF-e em XML e PDF** (mesmo `documentKey`) não duplica a compra (Review #1).
- [ ] Step 2: FAIL.
- [ ] Step 3: implementar associação + dedup por `documentKey`.
- [ ] Step 4: `npx jest cost-association cost-import.service` → PASS.
- [ ] Step 5: commit `feat(costs): associação por SKU/EAN/vínculo e dedup entre formatos`.

### Task 8: Cálculo de CMV + cobertura
**Files:** `cmv.service.ts`; tests `cmv.service.spec.ts`.
**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `cmvForOrder(orderId, tenantId): { lines[], cmv: Decimal|null, complete: boolean }` (linha sem custo → pendente; pedido completo só com todas as linhas); `coverage(tenantId, accountId, from, to): { byOrders:{withCost,total}, byValue:{withCost,total}, subtotalComplete: Decimal }` (denominador por valor = Σ `unitPrice×quantity`; só pedidos em estados que geram receita).
- [ ] Step 1 (RED): **caso sintético** — pedido 2 itens, custo só para 1 → `complete=false`, `cmv=null`, com subtotal do item com custo; **nunca** apresenta CMV completo. Custo para ambos → `cmv` = soma correta. `coverage` conta cancelados à parte.
- [ ] Step 2: FAIL.
- [ ] Step 3: implementar; arredondamento só na totalização.
- [ ] Step 4: `npx jest cmv.service` → PASS.
- [ ] Step 5: commit `feat(costs): CMV por pedido e cobertura por conta`.

### Task 9: API de custos + isolamento
**Files:** `costs.controller.ts`, `costs.module.ts`; test `costs.e2e.spec.ts` (MemoryPrisma) + guard de posse.
**Interfaces:**
- Consumes: Tasks 5–8.
- Produces: `POST /costs/imports` (upload+draft), `GET /costs/imports/:id` (prévia), `POST /costs/imports/:id/confirm`, `GET /costs/cmv?account&from&to` (CMV+cobertura por pedido), todos com AuthGuard + posse de conta validada no backend.
- [ ] Step 1 (RED): pedido de conta de **outro tenant** → 404; confirmar import de conta sem posse → 403; `GET /costs/cmv` devolve cobertura com pendências.
- [ ] Step 2: FAIL.
- [ ] Step 3: implementar controller/module; validar upload (tipo/tamanho/conteúdo).
- [ ] Step 4: `npx jest costs` → PASS.
- [ ] Step 5: commit `feat(costs): endpoints de importação e CMV com isolamento`.

### Task 10: UI "Produtos e custos" + assistente de importação
**Files:** `app/(dashboard)/produtos/` (página + abas Catálogo/Custos/Kits/Análise), wizard (cliente), route handlers `app/api/costs/…`; usa `docs/design/tokens.css`.
**Interfaces:**
- Consumes: Task 9.
- Produces: percurso selecionar conta → importar (upload Excel/XML/PDF) → prévia com erros por linha → associação → confirmar → ver CMV por pedido com cobertura/pendências.
- [ ] Step 1: construir as telas conforme o sistema visual (estados vazio/pendente honestos; dinheiro pt-BR tabular; nenhum subtotal apresentado como lucro da conta).
- [ ] Step 2: `npm run typecheck && cd apps/web && npx eslint … && npx next build` → sem erros.
- [ ] Step 3: commit `feat(web): Produtos e custos com assistente de importação e CMV`.

### Task 11: Percurso e validação
**Files:** `dre-flow.spec.ts` (integração MemoryPrisma); `CLAUDE.md`.
**Interfaces:** Consumes: todas.
- [ ] Step 1 (RED): percurso completo **selecionar conta → importar custos → rever vínculos → confirmar → CMV do período → conferir pedido**; afirma isolamento (2 contas/mesmo EAN), kits/vigência, não-duplicação, custo em falta → pendente.
- [ ] Step 2: FAIL → implementar o que faltar.
- [ ] Step 3: suite completa `npx jest`, `npm run typecheck`, builds, `scan-secrets` → verdes.
- [ ] Step 4: `CLAUDE.md` com o estado real do inc 1 (o que funciona, cobertura de dados reais, validação documental PENDENTE por falta dos ficheiros reais, o que fica para inc 2/3).
- [ ] Step 5: commit `test(dre): percurso de ponta a ponta do incremento 1`. **Parar e reportar**: ensaio/migração/produção só com OK explícito.

## Dependências dos incrementos seguintes (planos próprios)
- **Inc 2 — despesas ML + anti-dupla-contagem:** ledger normalizado de componentes a partir de `mlPaymentsRaw` + `saleFee`; semântica de frete/`shipping_cost`; devoluções/estornos; ADS/Full → possível alargamento documentado da allowlist.
- **Inc 3 — DRE completo + conciliação + export Excel/PDF.**
