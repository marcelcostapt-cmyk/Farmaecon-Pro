# DRE Gerencial por conta ML — Incremento 1: persistência de itens + importação de custos + CMV

Data: 2026-11-14 · Evidência: captura real de `GET /orders/search` (conta 0072890c, 1 página/2 pedidos, total observado=9) em `scratchpad/orders-sample.sanitized.json` (PII redigida).

## 1. Intenção e porquê
Construir a **base financeira confiável** que o resto do Farmaecon (e futuros agentes de IA) vai consumir. O incremento 1 entrega: persistir **o que foi vendido** (itens de pedido + decomposição financeira que o `/orders/search` já devolve), importar **custos de produto documentados** (Excel/XML-NFe/PDF), associá-los aos itens vendidos com **histórico versionado**, e calcular o **CMV por pedido/período** com **cobertura explícita** (custo em falta → pendente, nunca zero). É um DRE **gerencial**, não fiscal. Os números são determinísticos (código), não IA.

## 2. Objetivos
- Persistir `OrderItem` + campos financeiros ricos do pedido (`sale_fee`, `payments`, `date_created`, `pack_id`) a partir do sync `/orders/search` existente — para a frente **e** com backfill histórico, idempotente.
- **Dinheiro exato** (NUMERIC/Prisma Decimal) em todas as colunas financeiras/custo novas; os `Float` legados ficam intactos.
- Estender `Product`: SKU **+ EAN/GTIN**, unidade/apresentação, **versões de custo** (vigência, documento de origem), composição de **kits**.
- Pipeline de importação de custos: Excel (.xlsx/.xls), XML NF-e, PDF (texto + OCR) → prévia → validação por linha → confirmação → proveniência guardada.
- Associação: vínculo confirmado → SKU/EAN exato → sugestão por descrição para confirmação humana. Nunca associar por nome parecido.
- CMV por item vendido usando a versão de custo válida na **data da venda no ML** (`date_created`); relatório de cobertura; custo em falta → pendente.
- **Isolamento estrito** por empresa(tenant)+conta em BD, ficheiros, filas e exportações.

## 3. Não-objetivos (incremento 1)
- Linhas de despesa ML calculadas (comissão, frete, tributos, ADS no DRE) → incremento 2 (os dados crus são capturados, o cálculo não).
- DRE completo + conciliação + exportações Excel/PDF → incremento 3.
- Escrever no ML (mantém-se OBSERVATION) e qualquer alteração da allowlist (não é precisa no inc 1).
- Agentes de IA.

## 4. Anti-objetivos (falha mesmo que "funcione")
- Mostrar CMV/lucro de um pedido quando falta custo (tem de ser **pendente**).
- Tratar `total_amount` como receita ou derivá-la automaticamente.
- Partilhar custos entre empresas, ou associar por nome/concentração/embalagem parecidos.
- Um custo novo alterar silenciosamente o CMV de pedidos históricos.
- Dupla contagem de um custo já incluído no valor de aquisição.
- Perder cêntimos no rateio de kits/packs.
- Qualquer escrita externa; quebrar o sync/scheduler existente.

## 5. Restrições
- Prisma 7 / Postgres com **RLS por tenant**; NestJS; BullMQ. O **sync windowed resumível e o scheduler de 15 min têm de continuar a funcionar** intocados.
- Dependências novas (justificadas): parser de folha (exceljs **ou** xlsx), XML (fast-xml-parser), PDF texto (pdf-parse/pdfjs), OCR (tesseract.js — pesado, carregar sob demanda). Dinheiro via Prisma `Decimal` (NUMERIC). Validar uploads; **bloquear XXE** no XML; tratar documentos como dados, nunca instruções.
- Evidência de amostra é 1 conta/2 pedidos/1 tipo de produto → as **regras de cálculo de casos de borda** (cancelado, devolução, Full/Flex, kit, multi-item) só se fecham com amostras mais largas, no incremento 2. O inc 1 **guarda** esses dados e calcula só CMV.
- `seller_sku` vem como **texto livre** (ex.: "6 MARCADORES NEON") e `seller_custom_field` pode ser null → associação automática só por SKU/EAN exato ou vínculo confirmado.

## 6. Abordagens (as 3 escolhidas, confirmadas pelo utilizador)
1. **Dinheiro:** colunas novas NUMERIC (Prisma Decimal); `Float` legado intacto. *(Rejeitadas: inteiros em cêntimos — pior para custos unitários com 4+ casas; decimal.js isolado — Prisma Decimal já cobre.)*
2. **Persistência/backfill:** estender o sync windowed para gravar itens; **job de backfill** com throttle para os pedidos históricos; scheduler intocado. *(Rejeitada: job financeiro separado que relê tudo — duplica paginação.)*
3. **Âmbito de captura:** gravar **tudo o disponível** já (itens, `sale_fee`, `payments`, datas, `pack_id`), DRE por fases; CMV no inc 1 a partir de custos importados. *(Rejeitada: só itens agora, reler depois — duplica leituras ML.)*

## 7. Design (o como)
### 7.1 Modelo de dados (migration aditiva)
- **`order_items`**: `id`, `tenant_id`, `marketplace_account_id`, `order_id`(FK→orders), `ml_item_id`, `ml_element_id` = `order_items[].element_id` da resposta ML (confirmado na captura: inteiro sequencial por pedido → `(tenant_id, order_id, ml_element_id)` é chave estável; estabilidade multi-item/kit reconfirmada no backfill), `seller_sku_raw`(text, como vem), `title`, `category_id`, `variation_id`, `variation_attributes`(jsonb), `quantity`(int), `unit_price`(NUMERIC), `gross_price`(NUMERIC), `sale_fee`(NUMERIC), `listing_type_id`, `currency_id`, `product_id`(FK→products, nullable = associação confirmada), timestamps. Único `(tenant_id, order_id, ml_element_id)`. RLS por tenant + posse via `order`.
- **`orders`** (aditivo, NUMERIC nullable, sem reescrever legado): `paid_amount`, `ml_date_created`(tz-aware, a data real da venda), `ml_date_closed`, `pack_id`, `status_detail`. O `total_amount` Float legado fica; novas somas usam os campos NUMERIC preenchidos pelo re-read.
- **Proveniência de pagamentos:** snapshot `payments[]` em **jsonb** no pedido (`ml_payments_raw`), lossless e rastreável. O **ledger normalizado de componentes financeiros** (anti-dupla-contagem) é desenhado no inc 2, quando as regras estiverem validadas. *(decisão minha — ver §9)*

### 7.2 Produto, custo e kits (migration aditiva)
- `products` +: `ean_gtin`(text null, único por tenant quando presente), `unit_of_sale`, `presentation`, `is_kit`(bool). O `cost_price` Float legado fica, mas **não** é usado para CMV.
- **`product_cost_versions`**: `product_id`, **`marketplace_account_id`** (escopo por conta — resolve builder-check #1 por §4 da spec), `unit_cost`(NUMERIC), `method`(IMPORTED_UNIT|LOT_WEIGHTED_AVG|MANUAL), `effective_from`(date), `source_kind`(EXCEL|NFE_XML|PDF|MANUAL), `source_document_id`, `created_by`, `created_at`. Item vendido usa a versão **da sua conta** com `effective_from ≤ data da venda` (a mais recente). O `Product` continua o catálogo por tenant (`@@unique([tenantId, sku])`, EAN único por tenant); o que diverge por conta é o **custo**, não a entidade produto — assim duas contas da mesma empresa com o mesmo EAN podem ter custos diferentes (aceite #3).
  - **Política de partilha:** por omissão o custo aplica-se só à conta que importou; aplicar a outras contas da mesma empresa exige ação explícita (`product_cost_share` ou flag de política). Nunca entre empresas.
- **`kit_components`**: `kit_product_id`, `component_product_id`, `quantity`. CMV do kit = Σ custo do componente × qtd.
- **`product_ml_links`**: associação confirmada `ml_item_id`/`seller_sku` ↔ `product_id` **por conta** (reutilizável).
- **Escopo por conta:** o custo pertence ao produto da empresa; aplicação a uma conta é explícita; partilha entre contas da mesma empresa exige configuração explícita (flag/tabela de escopo).

### 7.3 Importação de custos
- **`cost_import`** (lote): `format`, `original_filename`, `file_hash`(sha256), `document_key`(chave NF-e / dedup), `status`(DRAFT|CONFIRMED|PARTIAL), `account_id`, `uploaded_by`.
- **`cost_import_line`**: `raw`(jsonb), `parsed`{sku/ean, descrição, unidade, custo_unit, qtd, total, vigência, fornecedor, descontos, frete}, `validation`(VALID|ERROR|PENDING), `error_detail`, `matched_product_id`, `match_method`.
- **Parsers:**
  - **Excel** (exceljs): seleção de aba + mapeamento de colunas; modelo para download; **SKU/EAN como texto** (sem notação científica, zeros à esquerda preservados); valida separador decimal, linhas inválidas, divergência custo-unitário vs total; **nunca** executa macros/fórmulas (lê valores).
  - **XML NF-e** (fast-xml-parser, **XXE/DTD desativados**): extrai chave, CNPJ emitente/destinatário, itens (`cProd`,`cEAN`,`uCom`/`uTrib`,`qCom`/`qTrib`,`vUnCom`,`vProd`,desconto,frete); **`cProd` ≠ SKU do vendedor**; sinaliza divergência de CNPJ vs empresa selecionada; trata cancelada/devolução/incompleto.
  - **PDF** (pdf-parse; OCR tesseract.js como fallback): confiança + página/trecho de origem; correção manual antes de confirmar; ambíguo fica **pendente**, nunca adivinhado.
- **Comuns:** prévia antes de gravar custos ativos; guardar ficheiro original + hash + proveniência; **dedup** de reenvio e do mesmo documento em formatos diferentes (XML+PDF da mesma NF = uma compra); erros por linha, confirmar só as válidas; **importar compra ≠ despesa integral** (CMV usa unidades vendidas); validar upload (tipo/tamanho/permissões/conteúdo).
- **Custo de aquisição** = produtos − descontos + frete de compra + componentes aplicáveis (sem somar o que já está no valor de origem). **Média do lote** = Σ custos de aquisição / Σ unidades normalizadas (ponderada), rotulada como tal (não "custo médio móvel").

### 7.4 Associação
Ordem: (1) vínculo confirmado para a conta; (2) SKU exato ou EAN/GTIN exato (unidade/apresentação compatíveis, sem conflito); (3) sugestão por descrição para confirmação humana. Nunca automático por nome/concentração/embalagem diferentes. Vínculos confirmados persistem.

### 7.5 Cálculo do CMV
Por item vendido: produto via vínculo confirmado → versão de custo com `effective_from ≤ ml_date_created` (mais recente) → `CMV_linha = custo_unit × quantidade` (kit = Σ componentes). Sem custo válido na data → **linha pendente**. CMV do pedido = Σ linhas; **completo só se todas as linhas têm custo**. Cobertura reportada por **nº de pedidos** e por **valor vendido**. Falta de custo → pendente, nunca zero/completo.

### 7.6 Recuperação histórica (backfill)
Job BullMQ por conta, com throttle, que relê os pedidos existentes pelas janelas `/orders/search` (mesmo mecanismo resumível), fazendo upsert idempotente de `order_items` + campos financeiros. Separado do scheduler de 15 min; respeita limites do ML; resumível; **não** relê a cada abertura do painel.

### 7.7 Isolamento, segurança, precisão
- RLS por tenant em todas as tabelas novas + escopo de conta nas queries; a seleção de conta no frontend **não** é autorização (posse validada no backend).
- NUMERIC em tudo o que é financeiro; arredondamento explícito só nas totalizações; cêntimos preservados no rateio.
- Persistência idempotente (chaves únicas); jobs assíncronos; índices para o volume (~10k pedidos, crescente).
- Permissões: ver/importar/corrigir/reprocessar (exportar é inc 3, mas o scaffold de permissão entra já). Auditoria de alterações financeiras; proteger documentos + dados pessoais.

### 7.8 O que o incremento 1 entrega ao utilizador (visível)
Importar custos de uma conta, rever/confirmar, ver a associação, e ver o **CMV por pedido + cobertura** ("X% dos pedidos / do valor com custo"). **Não** é o DRE completo (inc 3). Esta fronteira é explícita na UI (identidade Farmaecon, pt-BR, BRL).

## 8. Critérios de aceite (subconjunto do inc 1, com evidência/testes)
1. Excel/XML/PDF: importar → rever → confirmar → vincular → CMV. *(spec #1, parte CMV)*
2. Mesmo documento reenviado (incl. XML+PDF da mesma NF) **não duplica** compras/custos. *(spec #2)*
3. Duas empresas/contas com o mesmo EAN e custos diferentes ficam isoladas. *(spec #3)*
4. Caixas/unidades/variações/anúncios múltiplos/kits usam quantidades corretas. *(spec #4)*
5. Média de lote usa quantidades + custo de aquisição, não média simples de preços. *(spec #5)*
6. Atualização de custo **não** altera vendas históricas fora da vigência. *(spec #6)*
9. Falta de CMV → **pendente**, não zero nem lucro completo. *(spec #9, parte CMV)*
13. Acesso cruzado por API/job/exportação é recusado. *(spec #13)*
14. **Nenhuma** escrita externa; o sync existente continua a funcionar. *(spec #14)*
- **Caso sintético (versão inc 1):** pedido com 2 itens, custo importado só para 1 → o CMV/result do pedido fica **pendente**, com subtotal identificado do item com custo, **nunca** apresentado como resultado completo do pedido. *(O caso completo dos R$ 48,00 — comissão/frete/ADS/tributos — é aceite do inc 3.)*

## 9. Decisões minhas (a confirmar na leitura)
- `payments` guardado como **snapshot jsonb** no inc 1; ledger normalizado de componentes no inc 2 (onde se definem as regras anti-dupla-contagem).
- `Float` legado mantido; **colunas NUMERIC novas** (sem conversão in-place — não recupera precisão perdida).
- O teste sintético completo dos R$ 48,00 é aceite do **inc 3**; o inc 1 testa a cobertura/pendência do CMV.
- A UI do inc 1 mostra importação de custos + CMV por pedido + cobertura, **explicitamente ainda não um DRE**.

## 10. Deixado ao construtor
- Escolha exata das libs (exceljs vs xlsx; pdf-parse vs pdfjs) dentro da restrição.
- Nomes de tabelas/colunas e índices concretos.
- Detalhe dos componentes de UI (identidade Farmaecon existente).
- Snapshot de pagamentos jsonb-no-pedido vs tabela lateral (inclino-me para jsonb no inc 1).
- Limiares de confiança do OCR.

## 11. Dependências dos incrementos seguintes
- **Inc 2 (despesas ML + ajustes):** ledger normalizado de componentes; regras anti-dupla-contagem (comissão via `sale_fee`; frete: confirmar semântica de `payments.shipping_cost` comprador vs vendedor por tipo logístico); devoluções/estornos; **amostras por conta/situação**. ADS e Full exigem fontes fora do `/orders/search` → possível **alargamento documentado da allowlist** (campanhas/billing) **restrito a leituras necessárias**, trazido como decisão própria.
- **Inc 3 (DRE + conciliação + export):** estrutura do DRE, datas de liberação/liquidação (relatório de pagamentos), export Excel/PDF reproduzindo o painel, snapshots de período fechado.

## 12. Resolução do builder-check (2026-11-14)
Revisor fresco levantou 5 questões. Estado:

- **#2 Chave de idempotência por linha — RESOLVIDO pela captura.** `ml_element_id` = `order_items[].element_id` (inteiro por pedido na resposta real). Ver §7.1.
- **#3 Base de "valor vendido" na cobertura — DECISÃO minha.** Denominador = **Σ(`unit_price` × `quantity`) dos itens** dos pedidos do período ("valor de mercadoria vendido"), explicitamente **não** receita (que fica para o inc 3). Rótulo na UI deixa isto claro.
- **#4 `effective_from` e fuso — DECISÃO minha.** Na importação, `effective_from` é **obrigatório e mostrado na prévia**; pré-preenchido pela **data de emissão da NF-e** (XML) quando existe, senão em branco para o utilizador definir — **nunca** fallback silencioso para a data de upload. `LOT_WEIGHTED_AVG`: `effective_from` = a mais antiga do lote (editável). Seleção da versão para CMV compara a **data-calendário local** de `ml_date_created` no **fuso configurado da conta** (America/Sao_Paulo) contra `effective_from`. Aplicação retroativa além disto exige período + prévia de impacto (como a spec já diz).
- **#5 Cancelados/devolvidos na cobertura — DECISÃO minha.** Cobertura calculada sobre pedidos em **estados que geram receita** (PAID/SHIPPED/DELIVERED e equivalentes); cancelados/devolvidos mostrados **à parte**, fora do denominador, para não distorcer a % de cobertura. O cálculo de devolução em si fica para o inc 2.
- **#1 Escopo do custo: tenant ou conta ML — RESOLVIDO pela spec (§4).** As 6 contas estão num único tenant. A spec §4 fixa escopo **por conta** ("escopo e política explícitos para cada conta"), com partilha opt-in entre contas da mesma empresa e nunca entre empresas. Por isso `product_cost_versions` carrega `marketplace_account_id` e o `Product` fica como catálogo por tenant (ver §7.2 revisto). Aceite #3 cobre tanto cross-empresa (RLS) como cross-conta da mesma empresa (custo por conta). *(A confirmar na tua leitura; se o custo for de facto por empresa, simplifica-se removendo o escopo de conta.)*
