# Validação manual — Publicação de custos por SKU (ENSAIO)

Guião para exercitar, contra o **ambiente de ensaio** (nunca produção), o fluxo
completo de publicação de custos: `ingest → bonus → publish → product_costs`.

- **API do ensaio:** `http://127.0.0.1:13001/api/v1`
- **Compose:** `/opt/farmaecon/docker-compose.rehearsal.yml` · projeto `farmaecon-rehearsal-teste`
- **Containers:** `farmaecon-rehearsal-teste-api-1`, `…-db-1` · `MARKETPLACE_SOURCE=MOCK`
- **Dados:** 100% sintéticos. A fixture `apps/api/test/fixtures/nfe-bonificacao-sintetica.xml`
  tem CNPJ de destinatário `00000000000272`, que casa com a conta semeada → vínculo automático.
- **Endpoints (ADMIN):** ver `apps/api/src/modules/dre/purchase-documents.controller.ts`.

> ⚠️ Nada aqui toca em produção nem no modo OBSERVATION. Só a base `farmaecon_rehearsal_db`.

---

## 0. Semear o piloto (idempotente)

A base do ensaio não está publicada no host; corremos o seed **dentro** da rede do
compose, reutilizando a imagem da API (tem Node + Prisma client + deps). O script tem
guarda tripla (`MARKETPLACE_SOURCE=MOCK`, host local e nome exato da BD) e recusa
qualquer outro destino.

```bash
cd /opt/farmaecon   # onde vive o deploy do ensaio
# 1) copiar o seed para dentro do container da API (em /app, para resolver node_modules)
docker cp /caminho/do/repo/scripts/rehearsal-seed-cost-pilot.mjs \
  farmaecon-rehearsal-teste-api-1:/app/seed-cost-pilot.mjs

# 2) correr o seed (defina uma senha forte; não a versione)
docker compose -p farmaecon-rehearsal-teste -f docker-compose.rehearsal.yml exec \
  -w /app \
  -e MARKETPLACE_SOURCE=MOCK \
  -e PILOT_ADMIN_PASSWORD='troque-esta-senha-forte' \
  -e DATABASE_URL='postgresql://farmaecon:rehearsal_postgres_password_32chars@db:5432/farmaecon_rehearsal_db' \
  api node seed-cost-pilot.mjs
```

Semeia: tenant `rehearsal-cost-pilot`, utilizador ADMIN `admin-cost-pilot@rehearsal.local`
e conta ML sintética `ML #1773172867` (CNPJ `00000000000272`, `status=ACTIVE`).

---

## 1. Login (obter o token)

```bash
HOST='http://127.0.0.1:13001/api/v1'
TOKEN=$(curl -s "$HOST/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin-cost-pilot@rehearsal.local","password":"troque-esta-senha-forte"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["accessToken"])')
echo "token: ${TOKEN:0:12}…"
```

## 2. Importar o documento (ingest) — guarda em PENDING_REVIEW, NÃO publica

```bash
INVOICE=$(curl -s "$HOST/dre/purchase-documents" \
  -H "Authorization: Bearer $TOKEN" \
  -F 'file=@apps/api/test/fixtures/nfe-bonificacao-sintetica.xml' \
  | python3 -c 'import sys,json; d=json.load(sys.stdin)["data"]; print(d["invoiceId"]); import sys; sys.stderr.write(json.dumps(d["accountMatch"])+"\n")')
echo "invoiceId: $INVOICE"
```

A resposta traz `accountMatch.linkedAccountId` já preenchido (vínculo por CNPJ).

### 2b. (Só se o vínculo não for automático) vincular conta manualmente

```bash
# ACCOUNT_ID = id da conta ML (a1b2c3d4-0000-4000-8000-000000000001)
curl -s "$HOST/dre/purchase-documents/$INVOICE/account" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"accountId":"a1b2c3d4-0000-4000-8000-000000000001"}' | python3 -m json.tool
```

## 3. Aplicar bonificação (PROPORTIONAL §H) — recalcula custo por linha, NÃO publica

A fixture tem 2 linhas (vProd 100 e 300; total 400). Com bónus 40, o rateio
proporcional dá custo 11 e 33 por unidade.

```bash
curl -s "$HOST/dre/purchase-documents/$INVOICE/bonus" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"hasBonus":true,"bonusAmount":"40","rule":"PROPORTIONAL"}' | python3 -m json.tool
```

Alternativas de `rule`: `"IGNORE"` (linha bonificada fica sem custo) ou
`"SPECIFIC_SKU"` com `"specificSkuEan":"7897777700022"` (todo o bónus num EAN).
Override manual por linha: `"items":[{"lineNumber":"1","manualUnitCost":"7.5"}]`.

## 4. Publicar (grava product_costs APPROVED) — confirmação obrigatória

```bash
curl -s "$HOST/dre/purchase-documents/$INVOICE/publish" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"confirm":true}' | python3 -m json.tool
```

Esperado: `{ "data": { "publishedCount": 2, "ruleType": "PROPORTIONAL_SPREAD", "costs": [...] } }`.
Um segundo `publish` do mesmo documento é recusado (já não está em PENDING_REVIEW).

## 5. Confirmar na base (SQL)

```bash
docker exec -i farmaecon-rehearsal-teste-db-1 \
  psql -U farmaecon -d farmaecon_rehearsal_db -c \
  "select ean, sku, unit_cost, status, valid_from
     from product_costs
    where tenant_id = 'rehearsal-cost-pilot'
    order by ean;"
```

Esperado: 2 linhas `APPROVED`, `unit_cost` 11.0000 (EAN …011) e 33.0000 (EAN …022),
`valid_from` = data de emissão da NF-e (2026-04-10, default temporário da Decisão #5).

Estado do documento e da regra de rateio:

```bash
docker exec -i farmaecon-rehearsal-teste-db-1 \
  psql -U farmaecon -d farmaecon_rehearsal_db -c \
  "select status from purchase_invoices where tenant_id='rehearsal-cost-pilot';
   select rule_type, approved_at is not null as aprovada
     from cost_allocation_rules where tenant_id='rehearsal-cost-pilot';"
```

Esperado: documento `APPROVED`; regra `PROPORTIONAL_SPREAD`, `aprovada = t`.

---

## Limpeza (opcional)

```bash
docker exec -i farmaecon-rehearsal-teste-db-1 \
  psql -U farmaecon -d farmaecon_rehearsal_db -c \
  "delete from tenants where id = 'rehearsal-cost-pilot';"  -- CASCADE limpa custos, documentos, conta e utilizador
```

> A coleção importável (Postman/Bruno/Hoppscotch) com os mesmos pedidos está em
> [`docs/bruno/dre-custos.json`](./bruno/dre-custos.json).
