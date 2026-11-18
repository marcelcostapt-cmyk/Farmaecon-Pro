# Publicação manual de custos por SKU com bonificação — Design

_2026-11-18 · branch de feature; nada em produção_

## Intenção e porquê

Desbloquear o **lucro real por pedido** publicando custos por SKU a partir de
documentos fiscais, com a bonificação decidida **por documento** pelo utilizador.
Hoje o custo é ingerido (`purchase_invoices`/`_items` em `PENDING_REVIEW`) mas
nunca publicado em `product_costs`, porque faltava a regra de bonificação. Esta
feature é a **resolução da Decisão #2** do DRE (ver `docs/dre-7-decisoes-negocio.md`):
o utilizador escolhe a regra no momento da aprovação; a regra PROPORCIONAL inclui
o valor bonificado — custo = (pago da linha + bonificação alocada) ÷ unidades (§H).

Piloto: conta ML #1773172867 ("droga domínio"). Validação nesta fase com **fixture
sintética** (CNPJs/chaves fictícios) no ensaio; o teste com conta e XML reais fica
para quando o Márcio os fornecer.

## Objetivos

1. Fluxo de 3 passos sobre documentos já ingeridos: **prévia → decidir bonificação
   (recalcular, sem publicar) → aprovar e publicar**.
2. Três regras de bonificação, mapeadas ao enum existente `AllocationRuleType`:
   - `PROPORTIONAL` → `PROPORTIONAL_SPREAD`: `allocatedBonus = bonusAmount ×
     (totalLinha ÷ totalDocumento)`; `custoUnit = (totalLinha + allocatedBonus) ÷
     quantidade`.
   - `IGNORE` → `ZERO_BONUS`: `allocatedBonus = 0`; unidades bonificadas entram sem
     custo (`bonusQuantity` registado; custo só sobre unidades pagas).
   - `SPECIFIC_SKU` → `MANUAL` com `parameters = { scope: "specific_sku", ean|sku }`:
     toda a bonificação vai para a linha alvo.
3. Publicação **só manual e explícita**, escrevendo `product_costs` (APPROVED) +
   `cost_allocation_rules`, por tenant e vinculada à conta ML quando há vínculo.
4. UI mínima `/dre/preview` (upload + conta, tabela de itens, card de bonificação,
   recalcular, aprovar+publicar).
5. Provas: unitárias (cálculo das regras) + e2e em Postgres real no ensaio.
6. **Entregável de validação manual:** um guião pronto (curl + coleção Bruno/Hoppscotch)
   para o Márcio correr o fluxo completo no ensaio com a conta sintética, antes de
   passarmos a dados reais.

## Não-objetivos

- Escrita no Mercado Livre (promoções, estoque, anúncios) e mudar o modo OBSERVATION.
- Agentes de recomendação (vêm depois de haver custos publicados).
- Teste com dados reais/produção (deferido).
- CRUD completo de `product_costs`/`cost_allocation_rules` além do necessário à publicação.

## Anti-objetivos (falha mesmo que "funcione")

- Publicar custo **zero ou negativo**.
- Publicar **sem regra aprovada** ou documento **sem vínculo** a conta ML do tenant.
- **Duplicar** colunas de schema que já existem.
- Publicar automaticamente, sem confirmação humana.
- Versionar CNPJ/CPF, chaves de acesso ou nomes de fornecedores reais.

## Restrições

pt-BR em código/erros/commits; TDD; RLS por tenant em toda a leitura/escrita;
migration **aditiva, sem DROP**; AdminGuard na aprovação/publicação; sem deploy em
produção; não matar/reiniciar containers (KILL RULE); não tocar em dados de produção.

## Abordagens

- **A — Reaproveitar o schema e construir só a publicação (ESCOLHIDA).** O schema já
  tem `hasBonus`, `bonusAmount`, `bonusQuantity`, `paidQuantity`, `unitCostApproved`
  (= "finalUnitCost"), `status` (`CostLifecycle`) e `cost_allocation_rules`
  (`approvedBy/At`). O que falta é o caminho de publicação e a UI. Mudança de schema
  mínima: uma coluna `allocated_bonus` por item (auditoria).
- **B — Seguir o prompt à letra (REJEITADA).** Criar `hasBonus`, `bonusRule`,
  `reviewStatus`, `grossUnitCost`, `finalUnitCost`, `bonusQuantity`, `approvedBy/At`
  novas e `POST /dre/preview`. Rejeitada: duplica colunas existentes e colide com o
  `GET /dre/preview` atual. (Decisão do Márcio: aprovada a via A.)

## Como fica (decidido)

### Schema (migration aditiva)
`purchase_invoice_items`: adicionar `allocatedBonus Decimal? @map("allocated_bonus")`.
Nada mais. Migration `YYYYMMDD_dre_allocated_bonus` (só `ADD COLUMN`, sem DROP).

### Fluxo e endpoints (sob `@Controller('dre/purchase-documents')`, AdminGuard)
0. **Já existe** `POST /dre/purchase-documents/preview` (dry-run, não grava) — para o
   utilizador ver antes de persistir.
1. **Já existe** `POST /dre/purchase-documents` (ingest ADMIN) → persiste
   invoice+itens `PENDING_REVIEW` e **auto-vincula** a conta por CNPJ. Devolve
   `invoiceId`. **Na UI, o upload persiste por aqui** (precisamos do `invoiceId` para
   os passos seguintes); é idempotente por (tenant, sha256).
1b. **Novo** `POST /dre/purchase-documents/:id/account` — envolve o
   `associateAccountManually` já existente (compatibilidade fiscal: CNPJ do destinatário
   = CNPJ da conta), expondo-o por HTTP (até agora era diferido). Serve a seleção de
   conta da UI quando o auto-vínculo por CNPJ não resolve. AdminGuard, escopo tenant.
2. **Novo** `POST /dre/purchase-documents/:id/bonus` — body
   `{ hasBonus, bonusAmount, bonusRule, specificSkuEan?, items?: [{ lineNumber, manualUnitCost? }] }`.
   Calcula por linha `allocatedBonus`, `bonusQuantity` e `unitCostApproved` conforme a
   regra (ou usa `manualUnitCost` quando dado). **Grava** nos itens + `invoice.hasBonus/
   bonusAmount`, mantém `status = PENDING_REVIEW`. Devolve a prévia recalculada. Não publica.
3. **Novo** `POST /dre/purchase-documents/:id/publish` — body de confirmação explícita.
   Valida as guardas (abaixo); cria `CostAllocationRule` (`ruleType`+`parameters`,
   `approvedBy/At`); para cada item com `unitCostApproved > 0` insere `ProductCost`
   (`status = APPROVED`, `unitCost = unitCostApproved`, `validFrom`, `sourceInvoiceItemId`,
   `costAllocationRuleId`, `marketplaceAccountId` do vínculo); liga `item.allocationRuleId`;
   põe `invoice.status = APPROVED`. Devolve resumo do publicado.

> Nomes: mantêm o padrão REST existente (`/:id/bonus`, `/:id/publish`) em vez de
> `/dre/apply-bonus` e `/dre/publish-costs` do prompt — decisão de consistência; troco
> se preferires.

### Cálculo da bonificação
Função pura `applyBonusAllocation(doc, { rule, bonusAmount, specificSkuEan, manual })`
→ por linha `{ allocatedBonus, bonusQuantity, unitCostApproved }`, coberta por testes
unitários. Reaproveita as fórmulas de `bonus-calc.ts`. Nunca devolve custo zero por
omissão: sem base paga, o item fica sem `unitCostApproved` (não publicável).

### Guardas de publicação
- `unitCostApproved > 0` para cada custo publicado (zero/negativo bloqueia).
- `invoice.marketplaceAccountId` presente e da mesma tenant.
- **Publicar só a partir de `PENDING_REVIEW`**: se o documento já está `APPROVED`,
  rejeita (evita duplicar `product_costs` numa segunda publicação).
- Confirmação explícita no body; AdminGuard; escopo tenant + RLS.
- Mantém-se o CHECK já existente: custo APPROVED exige regra de rateio.

### `product_costs`: versionamento aditivo (não destrutivo)
Inserir **nova** linha por publicação (append-only), com `validFrom = invoice.issuedAt
?? createdAt`. O resolver de custo (`resolveCostCandidate`) já escolhe "o mais recente
antes da venda", portanto versões convivem.

> **DEFAULT TEMPORÁRIO DA DECISÃO #5 (vigência).** `validFrom = issuedAt ?? createdAt`
> é provisório e tem de estar assinalado assim no código (comentário pt-BR a apontar a
> Decisão #5). Quando a #5 for decidida, a vigência deve passar a configuração **por
> tenant ou por conta ML**; o cálculo de `validFrom` fica isolado num único ponto
> (helper) para a troca ser trivial, sem mexer no resto da publicação.

### UI `/dre/preview` (Next 16 / React 19)
Página com upload + seleção de conta, tabela de itens (SKU, EAN, descrição, qtd, custo
bruto, custo sugerido, ações), card de bonificação (toggle + valor + select de regra;
valor obrigatório quando "Sim"), botão "Recalcular" (chama `/:id/bonus`) e "Aprovar e
publicar" (modal de confirmação → `/:id/publish`), com feedback do que foi publicado.
Segue o padrão existente de route handlers (`apps/web/.../api/.../api-bridge.ts`), sem
Server Actions novas. **Ler `node_modules/next/dist/docs/` antes de escrever** (ver
`apps/web/AGENTS.md`).

### Validação (ensaio, sem produção)
- Fixture sintética `apps/api/test/fixtures/nfe-bonificacao-sintetica.xml` (CNPJs/chaves
  fictícios), com bonificação conhecida para testar a regra PROPORCIONAL.
- e2e em Postgres real: ingest → `/:id/bonus` (PROPORTIONAL) → `/:id/publish` → asserir
  `product_costs` (valores, APPROVED, vínculo), e asserir que custo zero e documento sem
  vínculo são **bloqueados**.
- **Prova automática = suite e2e em Postgres real** (o mesmo harness de
  `purchase-invoice.service.spec`/e2e já existente, não os containers do ensaio).
- **Demo manual opcional** no ensaio por HTTP (conta sintética semeada), para ver o
  fluxo ponta-a-ponta. Produção e OBSERVATION intocados.

## Resolvido na revisão de builder (decisões minhas)
- O upload da UI persiste via o ingest existente (passo 1), não pela prévia — é o que
  dá o `invoiceId` para recalcular/publicar.
- Expõe-se o `associateAccountManually` num endpoint novo (1b) para a seleção de conta.
- Publicação só a partir de `PENDING_REVIEW` (idempotência contra duplo-publish).
- A prova é a suite e2e real; a demo no ensaio é opcional.

## O que fica para o builder
- Validação exata dos DTOs (class-validator) e mensagens pt-BR.
- Números exatos da fixture e dos asserts dos testes.
- Detalhes de estilo da UI (Tailwind) e estados de erro/carregamento.
- Se `product_costs` deve fechar `validUntil` da versão anterior (proponho não fechar;
  o resolver já trata por data) — decisão menor do builder.
