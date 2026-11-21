# Prontidão operacional dos agentes e plano de integração

Auditoria de 2026-11-21 sobre o HEAD `27a71e9` (branch `feature/ads-csv-import-ui`, PR #16). Só leitura: não executa nada em produção.

## 1. Estado de cada agente

### Gestor (`central-farma`)
- **Funciona**: consolida a última execução persistida de Analista e ADS da conta; mostra estado real de cada agente (nunca executado, em execução, concluído, bloqueado, falhou), prioridades, pendências e origem. Sem resultados: BLOCKED `SEM_RESULTADOS`.
- **Depende de dados reais**: não diretamente; depende das execuções do Analista e do ADS.
- **Depende de migrações**: `20261128_agent_runs` (tabela de execuções) não está em produção.
- **Decisões de negócio**: nenhuma específica.
- **Pronto para produção?** Não. Falta a migração e a validação com contas reais.

### Analista (`dose-certa`)
- **Funciona**: margem por SKU, alertas de limite, variação de taxas ML, com evidências. Ausência de custo ou de taxa é indisponível, nunca zero.
- **Depende de dados reais**: custos publicados (`product_costs` APPROVED) e pedidos com `order_items`. Em produção, pedidos antigos não têm itens até nova sincronização; e não há custos publicados.
- **Depende de migrações**: `20261120`–`20261127` (lotes, validades, IPI, grupo med, custos) e `20261128` (agent_runs). Não estão em produção.
- **Decisões de negócio pendentes**: IPI recuperável por documento ou por empresa; IBS/CBS na base; vigência (decisão #5); código fornecedor ↔ SKU (decisão #6); consumo de lote. Sem essas decisões, os custos reais não são publicáveis.
- **Pronto para produção?** Não. Depende de decisões do Márcio e de migrações.
- **Mix Ativo** (especialização do Analista: estoque, giro, Full, ruptura): não implementado.

### ADS (`giro-ads`)
- **Funciona**: investimento, período, origem, distribuição por SKU e campanha, regras explícitas, cruzamento com a margem do último Analista, recomendações de revisão. Importação de CSV em duas fases (pré-visualização sem gravar, confirmação).
- **Depende de dados reais**: um CSV de campanhas exportado pelo utilizador. O sistema não busca esses dados no Mercado Livre (sem escopo novo).
- **ROAS e ACOS**: indisponíveis. Os CSV não têm receita atribuída às campanhas. Calcular exige uma fonte de receita atribuída validada, o que exige decisão sobre escopos e permissões do Mercado Livre.
- **Depende de migrações**: `20261124_ads_costs` e `20261128_agent_runs`. Não estão em produção.
- **Decisões de negócio**: integração do ADS na margem (decisão pendente); fonte de receita atribuída.
- **Pronto para produção?** Não. Falta a migração e um primeiro CSV real validado pelo utilizador.

## 2. O que já está validado e o que não está

| Item | Validado | Como |
|---|---|---|
| Gestor, Analista e ADS: lógica | sim | unitários (496 na API) e E2E PostgreSQL (81) |
| Importação ADS: formato, erros por linha, tudo ou nada | sim | unitários do parser (19) e E2E |
| Reimportação sem duplicar | sim | E2E e browser no ensaio |
| Ficheiro re-exportado: aviso de possível duplicação | sim (aviso) | E2E e browser; **não** impede a duplicação, só avisa |
| Isolamento por tenant e conta | sim | E2E e testes de controlador |
| Permissões ADMIN/OPERATOR | sim | unitários e browser (403 e ausência do painel) |
| Dados reais de produção | **não** | sem ambiente seguro autorizado para copiar dados |
| Margem com custos reais | **não** | custos não publicados em produção |

## 3. Plano de integração dos PRs

Cadeia de dependências (cada PR é base do seguinte):

| Ordem | PR | Branch | Base | Estado |
|---|---|---|---|---|
| 1 | #13 | `integration/pr12-main-reconciliation` | `main` | Draft; CI verde em `d9ba6f2`/`8fc82e0` |
| 2 | #14 | `feature/office-agents-mvp` | #13 | Draft; CI verde em `aeb3ec3` |
| 3 | #15 | `feature/office-agent-giro-ads` | #14 | Draft; CI verde em `f6c85e6` |
| 4 | #16 | `feature/ads-csv-import-ui` | #15 | Draft; CI a validar |

**Migrações em produção** (ordem obrigatória; todas aditivas):
- Já aplicadas em produção: 16 migrações (auditoria de 2026-11-21, `.claude/auditoria-farmaecon-2026-11-21.md`).
- Em falta, pela ordem: `20261120_purchase_item_lot_dates`, `20261121_product_lots`, `20261122_product_lots_quantity`, `20261123_product_anvisa`, `20261124_ads_costs`, `20261125_purchase_item_anvisa`, `20261126_purchase_tax_fields`, `20261127_purchase_items_products_value`, `20261128_agent_runs`.
- Confirmar antes de aplicar: `SELECT migration_name FROM _prisma_migrations` em produção (leitura).

**Backups** (antes de qualquer alteração em produção, sem exceção):
1. `pg_dump -Fc` da base de produção, com verificação `pg_restore -l` e `sha256sum`.
2. Cópia do `production.env` e das tags de imagem atuais (`ROLLBACK_IMAGES`).
3. Contagens de referência: pedidos, contas, custos publicados.

**Testes antes de promover** (já feitos no ensaio, a repetir no HEAD final):
- CI completo do PR de topo; E2E PostgreSQL; diff de schema sem desvio nas tabelas novas (desvios pré-existentes em `margin_rules` e outras ficam registados, não corrigidos aqui).
- Migrações aplicadas do zero numa base isolada.
- Browser no ensaio com dados sintéticos.

**Passos de promoção** (só com autorização explícita do Márcio, em janela própria):
1. Merge do PR #13 em `main` (revisão humana).
2. Merge sequencial de #14, #15 e #16 (cada um depois do anterior; rebase só com autorização).
3. Backup (secção acima).
4. Aplicar as migrações em produção, na ordem indicada, com `migrate deploy` a partir da imagem.
5. Subir a API e a web com as novas tags, mantendo `MARKETPLACE_MODE=OBSERVATION`.
6. Verificar `/health`, o boot RLS check (agora com `agent_runs`: 18 tabelas) e a sincronização existente.

**Rollback**:
- Código: repor as tags anteriores (`ROLLBACK_IMAGES`) e o mesmo comando de `up`. Não exige alterar dados.
- Schema: as migrações são aditivas. Não há reversão automática. Desfazer exige restauro do dump, e só com autorização explícita. Como as tabelas novas estão vazias antes da primeira execução, reverter o código deixa as tabelas sem uso.
- Dados de ADS importados: podem ser removidos apenas por ordem explícita, por `source_hash`.

## 4. Anúncios (Vitrine Farma): próximo incremento recomendado

**Contexto**: o Anúncios precisa de catálogo, qualidade dos anúncios e preços. Buy Box e dados de anúncios do Mercado Livre exigem API oficial e possivelmente escopos novos. Não iniciar sem essa confirmação.

**Recomendação**: análise determinística da qualidade do **catálogo local** (`products`), sem nenhum escopo OAuth novo:
- produtos sem registo Anvisa quando a categoria exige (regra explícita, configurável);
- estoque abaixo do mínimo (`stock_quantity < min_stock_quantity`);
- preço-base abaixo do custo publicado (usar `product_costs` APPROVED do Analista, **não** `products.cost_price`, que é um campo legado sem regra de publicação);
- títulos vazios ou duplicados por SKU.

**Reutiliza**: `products` (cadastro e validações existentes), `product_costs` e a lógica de margem do Analista (sem recalcular), e a mesma estrutura de execução (`agent_runs`, estados reais, evidências).

**Limites**: o catálogo local não é o anúncio publicado no Mercado Livre. Os achados são sobre o cadastro do utilizador, e isso deve ser dito na interface. Não cria, altera nem pausa anúncios.

**Riscos**: `products.cost_price` e `product_costs` podem divergir. A regra deve usar apenas o custo publicado e declarar quando não há custo publicado.

## 5. Decisões pendentes (não tomadas por esta auditoria)
- IPI, IBS/CBS, vigência, código fornecedor ↔ SKU, consumo de lote (Analista).
- Fonte de receita atribuída às campanhas (ROAS e ACOS).
- Integração do ADS na margem.
- Confirmação das APIs oficiais, permissões e políticas do Mercado Livre Brasil para SAC e Buy Box.
