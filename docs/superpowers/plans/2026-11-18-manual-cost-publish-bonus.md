# Publicação manual de custos por SKU com bonificação — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar custos por SKU em `product_costs` a partir de documentos já ingeridos, com a bonificação decidida por documento (prévia → recalcular → aprovar → publicar).

**Architecture:** Reaproveita o schema e a ingestão existentes. Acrescenta uma função pura de alocação de bonificação, um serviço de publicação (`CostPublicationService`), três endpoints REST sob o controlador existente, uma UI mínima e um kit de validação manual no ensaio. Única mudança de schema: coluna aditiva `allocated_bonus` por item.

**Tech Stack:** NestJS 11 + Prisma 7 (Postgres, RLS por tenant) na API; Next 16 / React 19 na web; Jest (unit + e2e Postgres real); `Prisma.Decimal` para dinheiro.

**Spec:** `docs/superpowers/specs/2026-11-18-manual-cost-publish-bonus-design.md`

## Global Constraints

- pt-BR em código, comentários, mensagens de erro, commits e docs.
- TDD: teste a falhar primeiro em toda a lógica nova; dinheiro com `Prisma.Decimal` (helper `money` de `../costs/cost-money`), nunca `number`.
- RLS por tenant: toda a leitura/escrita filtra por `tenantId`; escrita em transação.
- Endpoints novos sob `@Controller('dre/purchase-documents')`: `POST /:id/account`, `POST /:id/bonus`, `POST /:id/publish`. AdminGuard (role === 'ADMIN', padrão do `ingest` existente).
- Migration **aditiva, sem DROP** (só `ADD COLUMN`).
- Mapeamento de regra: `PROPORTIONAL` → `PROPORTIONAL_SPREAD` (inclui bonificado, §H); `IGNORE` → `ZERO_BONUS`; `SPECIFIC_SKU` → `MANUAL` com `parameters = { rule, bonusAmount, specificSkuEan }`.
- `validFrom = issuedAt ?? createdAt` é **DEFAULT TEMPORÁRIO da Decisão #5** — isolado num único helper `resolveValidFrom`, com comentário pt-BR a apontar a Decisão #5.
- Nunca publicar custo `<= 0`; publicar só a partir de `status = PENDING_REVIEW`; publicação em transação atómica.
- Fixtures/seed só com CNPJs/chaves/nomes **fictícios**; nunca versionar dados fiscais reais. Sem deploy, sem tocar em produção nem no modo OBSERVATION, sem matar/reiniciar containers.

## Review Focus

1. `bonusAmount` negativo, ou `hasBonus=true` com `bonusAmount` ausente/0 → rejeitar ("valor obrigatório quando há bonificação"). → Task 2.
2. `SPECIFIC_SKU` com `specificSkuEan` que não casa com nenhuma linha → rejeitar com erro claro (não engolir a bonificação). → Task 2.
3. Itens sem EAN e sem SKU (pedidos ML casam por SKU/descrição) → `product_cost` é gravado na mesma com `supplierCode`/`description`, não é saltado. → Task 4.
4. `/:id/bonus` chamado várias vezes com regras diferentes → a última decisão substitui a anterior nos itens (não acumula `allocated_bonus`). → Task 4.
5. Duplo `publish` (duplo clique) → o segundo é bloqueado (`status != PENDING_REVIEW`), e a transação garante que não fica `APPROVED` sem `product_costs`. → Task 4.

---

### Task 1: Schema — coluna aditiva `allocated_bonus`

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `PurchaseInvoiceItem`)
- Create: `apps/api/prisma/migrations/20261118_dre_allocated_bonus/migration.sql`

**Interfaces:**
- Produces: campo `allocatedBonus Decimal? @map("allocated_bonus")` em `PurchaseInvoiceItem`.

- [ ] **Step 1:** Em `schema.prisma`, no model `PurchaseInvoiceItem`, adicionar `allocatedBonus Decimal? @map("allocated_bonus")` (junto a `bonusQuantity`).
- [ ] **Step 2:** Criar `migration.sql` com uma só instrução: `ALTER TABLE purchase_invoice_items ADD COLUMN allocated_bonus DECIMAL(19,4);` (sem DROP, sem backfill).
- [ ] **Step 3: Verificar** `npx prisma validate --schema apps/api/prisma/schema.prisma`. Esperado: `is valid`.
- [ ] **Step 4: Verificar** que a migration é aditiva: `grep -i drop apps/api/prisma/migrations/20261118_dre_allocated_bonus/migration.sql`. Esperado: sem resultados.
- [ ] **Step 5: Commit** `feat(dre): coluna aditiva allocated_bonus por item`.

---

### Task 2: Função pura `applyBonusAllocation`

**Files:**
- Create: `apps/api/src/modules/costs/bonus-allocation.ts`
- Test: `apps/api/src/modules/costs/bonus-allocation.spec.ts`

**Interfaces:**
- Consumes: `money` de `./cost-money`; `Prisma.Decimal`.
- Produces:
  ```ts
  export type BonusRule = 'PROPORTIONAL' | 'SPECIFIC_SKU' | 'IGNORE';
  export interface BonusAllocationLine {
    lineNumber: string; ean: string | null; marketplaceSku: string | null;
    supplierCode: string | null; quantity: Prisma.Decimal; totalLine: Prisma.Decimal;
    isBonus: boolean; bonusQuantity: Prisma.Decimal;
  }
  export interface BonusDecision {
    hasBonus: boolean; bonusAmount: Prisma.Decimal; rule: BonusRule;
    specificSkuEan?: string | null; manual?: Record<string, Prisma.Decimal | null>;
  }
  export interface AllocationLineResult {
    lineNumber: string; allocatedBonus: Prisma.Decimal;
    bonusQuantity: Prisma.Decimal; unitCostApproved: Prisma.Decimal | null;
  }
  export function applyBonusAllocation(
    lines: BonusAllocationLine[], documentTotal: Prisma.Decimal, decision: BonusDecision,
  ): AllocationLineResult[];
  ```

- [ ] **Step 1: Escrever os testes a falhar** em `bonus-allocation.spec.ts`:
  - `test('PROPORTIONAL (§H): custo = (totalLinha + bónus rateado) ÷ quantidade')` — 2 linhas pagas, `documentTotal` = soma, `bonusAmount` reparte por `totalLine/documentTotal`; asserir `allocatedBonus` e `unitCostApproved` por linha.
  - `test('IGNORE: allocatedBonus 0; linha bonificada fica sem custo; paga = totalLinha ÷ quantidade')`.
  - `test('SPECIFIC_SKU: toda a bonificação na linha alvo; outras allocatedBonus 0')`.
  - `test('SPECIFIC_SKU com EAN inexistente lança erro claro')` — `assert throws /não encontr/i`.
  - `test('hasBonus=true sem bonusAmount>0 lança "valor obrigatório"')` e `test('bonusAmount negativo lança')`.
  - `test('manualUnitCost sobrepõe o custo calculado da linha')`.
  - `test('quantidade 0 → unitCostApproved null (nunca divisão por zero nem custo fabricado)')`.
- [ ] **Step 2: Verificar que falham** `npx jest bonus-allocation -c apps/api/package.json`. Esperado: FAIL (módulo não existe).
- [ ] **Step 3: Implementar** `applyBonusAllocation`. Regras no Global Constraints; `PROPORTIONAL`: `allocatedBonus_i = bonusAmount × (totalLine_i / documentTotal)`, `unitCostApproved_i = (totalLine_i + allocatedBonus_i) / quantity_i`; `IGNORE`: `allocatedBonus=0`, `unitCostApproved = isBonus ? null : totalLine_i / quantity_i`; `SPECIFIC_SKU`: alvo por `ean` ou `marketplaceSku === specificSkuEan`, recebe todo o `bonusAmount`; `manual[lineNumber]` não-nulo sobrepõe. Divisão por quantidade 0 → `null`.
- [ ] **Step 4: Verificar que passam** `npx jest bonus-allocation -c apps/api/package.json`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(dre): alocação de bonificação por regra (PROPORTIONAL/SPECIFIC_SKU/IGNORE)`.

---

### Task 3: Helper `resolveValidFrom` (Decisão #5 isolada)

**Files:**
- Create: `apps/api/src/modules/dre/cost-validity.ts`
- Test: `apps/api/src/modules/dre/cost-validity.spec.ts`

**Interfaces:**
- Produces: `export function resolveValidFrom(invoice: { issuedAt: Date | null; createdAt: Date }): Date;`

- [ ] **Step 1: Teste a falhar:** `test('validFrom usa issuedAt; cai para createdAt quando issuedAt é null')` — dois casos.
- [ ] **Step 2: Verificar FAIL** `npx jest cost-validity -c apps/api/package.json`.
- [ ] **Step 3: Implementar** `resolveValidFrom` (`issuedAt ?? createdAt`) com comentário pt-BR: DEFAULT TEMPORÁRIO da Decisão #5; trocar por config por tenant/conta ML quando decidida.
- [ ] **Step 4: Verificar PASS.**
- [ ] **Step 5: Commit** `feat(dre): helper resolveValidFrom (default temporário da Decisão #5)`.

---

### Task 4: `CostPublicationService` (applyBonus + publishCosts)

**Files:**
- Create: `apps/api/src/modules/dre/cost-publication.service.ts`
- Test: `apps/api/src/modules/dre/cost-publication.service.spec.ts` (usa `../../../test/memory-prisma`)

**Interfaces:**
- Consumes: `PrismaService`; `applyBonusAllocation` (Task 2); `resolveValidFrom` (Task 3); enums `AllocationRuleType`, `CostLifecycle`.
- Produces:
  ```ts
  class CostPublicationService {
    constructor(prisma: PrismaService);
    applyBonus(tenantId: string, invoiceId: string, decision: BonusDecision, actor: { sub?: string } | null):
      Promise<{ invoiceId: string; items: AllocationLineResult[] }>;
    publishCosts(tenantId: string, invoiceId: string, actor: { sub?: string } | null):
      Promise<{ invoiceId: string; ruleType: AllocationRuleType; publishedCount: number;
                costs: { ean: string | null; sku: string | null; unitCost: string }[] }>;
  }
  ```

- [ ] **Step 1: Escrever os testes a falhar** (MemoryPrisma; semear `marketplaceAccount`, `purchaseInvoice` PENDING_REVIEW + itens):
  - `test('applyBonus grava allocatedBonus/bonusQuantity/unitCostApproved e mantém PENDING_REVIEW')`.
  - `test('applyBonus é substituível: segunda regra sobrepõe a primeira, não acumula')` (Review Focus 4).
  - `test('publishCosts cria 1 cost_allocation_rule e 1 product_cost APPROVED por item com custo>0, ligados')`.
  - `test('publishCosts grava product_cost mesmo sem EAN/SKU, por supplierCode/description')` (Review Focus 3).
  - `test('publishCosts bloqueia custo <= 0')` — `assert throws`.
  - `test('publishCosts bloqueia documento sem marketplaceAccountId')`.
  - `test('publishCosts bloqueia se status != PENDING_REVIEW (segundo publish)')` (Review Focus 5).
  - `test('publishCosts usa resolveValidFrom para validFrom')`.
  - `test('isolamento por tenant: invoice de outro tenant não é encontrado')`.
- [ ] **Step 2: Verificar FAIL** `npx jest cost-publication.service -c apps/api/package.json`.
- [ ] **Step 3: Implementar** o serviço. `applyBonus`: carrega invoice+itens por `(id, tenantId)`; monta `BonusAllocationLine[]`; chama `applyBonusAllocation(lines, documentTotal, decision)`; numa transação faz `updateMany` por item (`unitCostApproved`, `allocatedBonus`, `bonusQuantity`) e atualiza `invoice.hasBonus/bonusAmount`; devolve resultados. `publishCosts`: numa transação recarrega invoice (exige `PENDING_REVIEW` e `marketplaceAccountId`), valida todo `unitCostApproved` publicável `> 0` (se algum `<= 0` lança; itens sem custo definido são ignorados), cria `CostAllocationRule` (`ruleType` mapeado de `parameters.rule`, `approvedBy`/`approvedAt`), insere `ProductCost` por item com custo (`status: APPROVED`, `unitCost`, `validFrom: resolveValidFrom(invoice)`, `sourceInvoiceItemId`, `costAllocationRuleId`, `marketplaceAccountId`, `ean`, `sku`, `supplierCode`, `description`), liga `item.allocationRuleId`, põe `invoice.status = APPROVED`. A `ruleType` vem da `parameters.rule` guardada no `applyBonus` (guardar `parameters` na invoice via campo existente ou recomputar da decisão — ver nota).
- [ ] **Step 4: Verificar PASS** `npx jest cost-publication.service -c apps/api/package.json`.
- [ ] **Step 5: Commit** `feat(dre): serviço de publicação de custos (applyBonus + publishCosts)`.

> Nota de interface: a regra escolhida tem de sobreviver entre `applyBonus` e `publishCosts`. Guardar a decisão (`rule`, `bonusAmount`, `specificSkuEan`) em `invoice.extractionWarnings` é frágil; preferir receber a decisão também no `publish` **ou** persistir um rascunho de `CostAllocationRule` (sem `approvedAt`) no `applyBonus` e aprová-lo no `publish`. O implementador escolhe a mais limpa e regista a decisão (ledger).

---

### Task 5: Endpoints REST + DTOs

**Files:**
- Create: `apps/api/src/modules/dre/dto/associate-account.dto.ts`, `apps/api/src/modules/dre/dto/bonus-decision.dto.ts`, `apps/api/src/modules/dre/dto/publish.dto.ts`
- Modify: `apps/api/src/modules/dre/purchase-documents.controller.ts`, `apps/api/src/modules/dre/dre.module.ts`
- Test: `apps/api/src/modules/dre/purchase-documents.controller.spec.ts` (estender o existente)

**Interfaces:**
- Consumes: `CostPublicationService` (Task 4); `PurchaseInvoiceService.associateAccountManually` (já existe).
- Produces: três rotas `POST /dre/purchase-documents/:id/{account,bonus,publish}`, todas ADMIN, resposta via `ok(...)`.

- [ ] **Step 1: Escrever os testes a falhar** (mocks dos serviços):
  - `test('POST :id/account rejeita não-ADMIN (403) e delega associateAccountManually para ADMIN')`.
  - `test('POST :id/bonus valida o DTO (hasBonus+bonusAmount) e chama applyBonus')`.
  - `test('POST :id/publish chama publishCosts e devolve o resumo')`.
- [ ] **Step 2: Verificar FAIL.**
- [ ] **Step 3: Implementar** os DTOs com `class-validator` (mensagens pt-BR): `AssociateAccountDto { accountId: string @IsUUID }`; `BonusDecisionDto { hasBonus: boolean; bonusAmount?: string; rule: BonusRule @IsIn; specificSkuEan?: string; items?: { lineNumber: string; manualUnitCost?: string }[] }` (converte strings→`Decimal` no controlador); `PublishDto { confirm: boolean @Equals(true) }`. Acrescentar as três rotas (ADMIN como no `ingest`), registar `CostPublicationService` em `dre.module.ts`.
- [ ] **Step 4: Verificar PASS** `npx jest purchase-documents.controller -c apps/api/package.json`.
- [ ] **Step 5: Commit** `feat(dre): endpoints :id/account, :id/bonus, :id/publish (ADMIN)`.

---

### Task 6: Fixture sintética + e2e em Postgres real

**Files:**
- Create: `apps/api/test/fixtures/nfe-bonificacao-sintetica.xml` (CNPJs/chaves fictícios; bonificação conhecida)
- Create: `apps/api/src/modules/dre/cost-publication.real.spec.ts`

**Interfaces:**
- Consumes: o harness de e2e em Postgres real já usado pelos testes de ingest do DRE (mesmo bootstrap/role RLS); `parseDocument`; `CostPublicationService`; `PurchaseInvoiceService`.

- [ ] **Step 1: Criar a fixture** sintética: NF-e com ≥2 linhas pagas + 1 bonificada, destinatário com CNPJ fictício **válido (DV)** igual ao da conta semeada, valores redondos para asserts determinísticos.
- [ ] **Step 2: Escrever os testes a falhar** (Postgres real, RLS):
  - `test('ingest → applyBonus(PROPORTIONAL) → publishCosts grava product_costs APPROVED com os custos esperados')` — asserir nº de linhas, `unitCost`, `status`, `marketplaceAccountId`, `costAllocationRuleId`.
  - `test('publish bloqueia documento sem vínculo a conta')`.
  - `test('segundo publish é bloqueado (idempotência)')`.
- [ ] **Step 3: Verificar FAIL** (serviço/fluxo ainda não ligado ao harness real).
- [ ] **Step 4:** Ligar o fluxo ao harness real (sem código novo de produção — só wiring de teste). 
- [ ] **Step 5: Verificar PASS** com o comando e2e real do projeto (o mesmo dos testes de ingest do DRE).
- [ ] **Step 6: Commit** `test(dre): e2e em Postgres real do fluxo de publicação de custos`.

---

### Task 7: UI mínima `/dre/preview`

**Files:**
- Create: `apps/web/src/app/dre/preview/page.tsx` (Server Component), um client component de formulário, e route handlers em `apps/web/src/app/api/dre/.../route.ts` com um `api-bridge.ts` (padrão de `apps/web/src/app/api/integrations/api-bridge.ts`).

**Interfaces:**
- Consumes: os três endpoints da Task 5 + o `POST /dre/purchase-documents` (upload) e `GET` de contas ML.

- [ ] **Step 1: LER PRIMEIRO** `node_modules/next/dist/docs/` a partir de `apps/web` (ver `apps/web/AGENTS.md`: esta versão do Next tem breaking changes; params de route handlers são `Promise`).
- [ ] **Step 2:** Route handlers JSON (bridge) para upload, account, bonus, publish — reencaminham para a API preservando o cookie de sessão (padrão integrations).
- [ ] **Step 3:** Página `/dre/preview`: upload + seleção de conta ML; tabela de itens (SKU, EAN, descrição, qtd, custo bruto, custo sugerido, ações); card de bonificação (toggle "Tem bonificação?", input de valor obrigatório quando Sim, select de regra); botão "Recalcular" (→ `:id/bonus`) e "Aprovar e publicar" com modal de confirmação (→ `:id/publish`); feedback com resumo do publicado. Tailwind, formulário controlado, validação básica.
- [ ] **Step 4: Verificar** `npm run typecheck` e `npm run build --workspace web`. Esperado: sem erros. (Sem harness de testes web no projeto; a prova funcional é a Task 8.)
- [ ] **Step 5: Commit** `feat(web): UI /dre/preview para revisão e publicação de custos`.

---

### Task 8: Kit de validação manual no ensaio

**Files:**
- Create: `scripts/rehearsal-seed-cost-pilot.mjs` (semeia tenant/user ADMIN/conta ML sintética cujo CNPJ casa com a fixture)
- Create: `docs/dre-teste-manual-ensaio.md` (guião curl + passos) e `docs/bruno/dre-custos.json` (coleção Bruno/Hoppscotch importável)

**Interfaces:**
- Consumes: os endpoints das Tasks 5; o compose de ensaio (`docker-compose.rehearsal.yml`, API em `127.0.0.1:13001`).

- [ ] **Step 1:** Script de seed idempotente para o ensaio (conta ML sintética + utilizador ADMIN; CNPJ fictício = o da fixture). Nunca correr contra produção (verifica `DATABASE_URL` do ensaio).
- [ ] **Step 2:** `docs/dre-teste-manual-ensaio.md` com a sequência curl: login → `POST /dre/purchase-documents` (upload da fixture) → `POST /:id/bonus` (PROPORTIONAL) → `POST /:id/publish` → `GET`/SQL de `product_costs`. Incluir os comandos `docker exec ... psql` úteis para confirmar.
- [ ] **Step 3:** Coleção `docs/bruno/dre-custos.json` com os mesmos pedidos (variáveis para host/token/invoiceId).
- [ ] **Step 4: Verificar** que o guião é coerente com os endpoints (rever rotas/payloads contra a Task 5). Nenhum dado real.
- [ ] **Step 5: Commit** `docs(dre): kit de validação manual no ensaio (curl + Bruno + seed sintético)`.

---

## Notas de execução
- Branch sugerida: `feature/manual-cost-publish-bonus` a partir de `feature/merge-ml-resumable-sync` (HEAD `10d26ea`) — criada pela skill de worktrees no arranque da execução.
- Sem deploy, sem produção, sem mexer no modo OBSERVATION. Fixtures/seed só sintéticos.
