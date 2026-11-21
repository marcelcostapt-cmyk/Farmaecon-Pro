# Escritório de agentes — arquitetura mínima (primeiro incremento)

Estado: branch `feature/office-agents-mvp` (a partir de `integration/pr12-main-reconciliation` @ `d9ba6f2`).
Não está em produção. Modo do produto: `OBSERVATION` (leitura).

## Dois tipos de "agente" — não confundir

| Tipo | Onde vive | Para quê |
|---|---|---|
| Subagentes de desenvolvimento | `.claude/agents/` (fora do repositório versionado) | Ajudam a construir o código no Claude Code. |
| Agentes operacionais do produto | `apps/api/src/modules/agents/` e `/escritorio` | Analisam dados reais de uma conta do Mercado Livre e registam o resultado. |

Só os segundos fazem parte do produto. Nenhum deles executa uma ação no Mercado Livre.

## Nomes, identificadores e serviços

Seis agentes visíveis no Escritório C2 (nomes públicos aprovados). As especializações não são agentes autónomos e não têm registo próprio.

| Nome público (C2) | Identificador técnico | Identificação interna | Serviços reutilizados | Responsabilidade | Estado |
|---|---|---|---|---|---|
| **Gestor** | `central-farma` | Central Farma | últimas execuções persistidas de Analista e ADS da conta | orquestração, consolidação, prioridades, pendências e mesa de reunião. **Não recalcula** números. | implementado |
| **Analista** | `dose-certa` | Dose Certa (custo, margem, CMV, análise financeira) + especialização Mix Ativo (produtos, estoque, giro, Full, ruptura) | `MarginService`, `product_costs`, `margin_rules`, `orders`/`order_items` | análises determinísticas com evidências | implementado (margem); Mix Ativo não implementado |
| **Anúncios** | `vitrine-farma` | Vitrine Farma | `products` (cadastro); margem do Analista para preços | catálogo, qualidade dos anúncios, preços e Buy Box quando suportada | não implementado; Buy Box só em documentação |
| **Criativo** | `criativo` | — (sem nome interno) | nenhum | conteúdos e imagens, com serviços próprios validados no futuro | não implementado |
| **ADS** | `giro-ads` | Giro Ads | `AdsService.profile` (CSV importado); última execução do Analista para cruzar margem | investimento, distribuição por SKU e campanha, regras explícitas. ROAS e ACOS só com receita atribuída confiável | implementado (leitura) |
| **SAC** | `balcao-digital` | Balcão Digital | nenhum | perguntas, mensagens, reclamações e atendimento | não implementado; só documentação |

Regras:
- Chaves técnicas já implementadas preservadas (`central-farma`, `dose-certa`, `giro-ads`, `balcao-digital`). `vitrine-farma` passa a Anúncios (antes estava como Criativo). `criativo` é novo.
- O Gestor consolida: o resultado do Analista é a fonte. O Gestor só acrescenta `consolidation` (`responsavelCalculo: dose-certa`). Testes garantem que `summary` e `findings` são iguais nos dois.
- Full e estoque pertencem ao Analista na interface; a implementação interna pode usar a especialização Mix Ativo, sem serviços duplicados.

Antes de implementar Buy Box e SAC:
- Confirmar endpoints oficiais, permissões e políticas do Mercado Livre Brasil.
- Não solicitar escopos OAuth novos e não implementar endpoints incertos.
- Até lá, ficam apenas em documentação, em modo de observação. O levantamento de 2026-11-21 encontrou candidatos (perguntas em `/questions/search`, competição de preço em `/items/{id}/price_to_win`), mas as páginas consultadas são de sites regionais e de datas diferentes, por isso não estão confirmados para o MLB.
- A allowlist de observação atual permite apenas `GET /orders/search` e `GET /users/{id}`.

## Camadas

| Camada | Onde | Responsabilidade |
|---|---|---|
| Fontes de dados | Prisma: `orders`, `order_items`, `product_costs` (APPROVED), `margin_rules`, `marketplace_accounts` | Só leitura, sempre filtrada por tenant (RLS + `tenantId`). |
| Ferramentas de consulta | `MarginService` (`preview`, `alerts`, `feeChanges`) | Reutiliza o cálculo de margem existente. Não é recriado. |
| Regras determinísticas | `central-farma-analysis.ts` (`blockReasonFor`, `analyseFinancialMargin`) | Função pura: bloqueios por dependência, achados, recomendações, fontes. |
| Motor de análise | o mesmo módulo | Sem LLM. Nenhuma resposta gerada por modelo de linguagem. |
| Orquestração | `agents.service.ts` (`run`) | Valida conta e agente, cria o registo `RUNNING`, lê dados, grava estado final ou `FAILED`. |
| Persistência | tabela `agent_runs` (migração `20261128_agent_runs`) | Histórico auditável. RLS por tenant. |
| API | `agents.controller.ts` | `GET /agents`, `POST /agents/:key/runs`, `GET /agents/runs`, `GET /agents/runs/:id`. |
| Interface | `/escritorio`, `/escritorio/execucoes/[id]` | Estados vindos da API; execução disparada por rota same-origin. |
| Auditoria | `agent_runs.result` (fontes, contagens, premissas), `requested_by`, datas | Cada execução mostra a origem dos dados. |

## Estados

| Estado | Quando | Mostra |
|---|---|---|
| Nunca executado | não há linha em `agent_runs` para o agente | "Nunca executado" |
| Em execução | `RUNNING` | "Em execução" (a execução é síncrona; ver limitações) |
| Concluído | `COMPLETED` | achados, recomendações, fontes |
| Bloqueado por dependência | `BLOCKED` com `blockReason` | a dependência em falta, sem números |
| Falhou | `FAILED` | mensagem genérica; detalhe técnico só no log do servidor |
| Ainda não implementado | agente com `implemented: false` | "Ainda não implementado"; a API recusa a execução |
| Estado indisponível | a API não respondeu | "Estado indisponível" (nunca "offline" nem "ativo") |

Motivos de bloqueio: `CONTA_DESCONECTADA`, `SEM_PEDIDOS`, `SEM_CUSTOS_APROVADOS`.

## Central Farma — o que a análise faz

1. Confirma a conta (pertence ao tenant) e conta pedidos, custos APPROVED e regras de margem.
2. Se faltar uma dependência, grava `BLOCKED` e não calcula nada.
3. Caso contrário, lê margem por SKU, alertas de limite e variação de taxa ML (≥ 2 pp).
4. Produz achados com severidade (`risco`, `pendencia`, `info`), evidência por campo e recomendações ligadas ao achado.
5. Declara as fontes com contagens e as premissas: margem líquida não é DRE; liquidações, reembolsos, frete e despesas não estão reconciliados.

Regra de ouro: SKU sem taxa ML ou sem custo APPROVED fica fora da conta, com o motivo. Nenhum valor é estimado.

## Segurança

- Nenhuma escrita no Mercado Livre. Nenhuma alteração de preço, anúncio, campanha, publicidade ou estoque.
- Única escrita: o registo da execução em `agent_runs`.
- Qualquer acesso a conta é filtrado por `tenantId`. Conta de outro tenant devolve 404 e não cria execução.
- Erros internos não são devolvidos ao cliente nem gravados em `error_message`; só o tipo do erro vai para o log.
- Nenhum dado de comprador é enviado a fornecedores de IA. Não há chamada a LLM.

## Limitações conhecidas

- A execução é síncrona, no pedido HTTP. Não há fila. Uma execução interrompida fica `RUNNING` até passar o limite de 10 minutos e ser fechada como `FAILED` (ver "Recuperação").
- `MarginService.loadRows` faz uma consulta de itens por pedido (N+1). Aceitável para contas pequenas; a medir antes de contas grandes.
- A análise usa os dados já sincronizados. Não consulta o Mercado Livre.
- `agent_runs` tem `ON DELETE CASCADE` na conta: remover uma conta remove o histórico dela.
- Nenhum agente além do Gestor (Central Farma) executa. Os outros cinco estão no catálogo como não implementados.

## Próximos passos (cada um com validação própria)

1. Analista (Dose Certa): preço, custo e rentabilidade; ligar a DRE quando houver reconciliação de liquidações (hoje a DRE é só preview).
2. Anúncios (Mix Ativo): revisão de anúncios e promoções sobre a margem validada. Estoque e Full dependem de dados que ainda não existem.
3. ADS (Giro Ads): depende da integração ADS na margem (decisão pendente).
4. Qualquer agente com ação real exige um gate próprio: autorização comercial pré-definida, modo de recomendação antes de ação e auditoria da alteração.

## Permissões

- Ver o escritório, executar a análise e ver execuções: qualquer utilizador autenticado do tenant, incluindo OPERATOR. A análise é de leitura e a única escrita é o registo da execução.
- Definir regras de margem continua reservado a ADMIN. Verificado no ensaio: OPERATOR recebe 403 em `PUT /margin/rules`.
- Conta de outro tenant: 404 na execução; margem e execuções pedidas com essa conta voltam vazias (verificado em PostgreSQL real).

## Escopo por conta

- O seletor "Conta em análise" grava `?conta=<id>`. Só aceita ids da lista do próprio tenant; senão usa a primeira conta.
- O cartão Margem por SKU, o catálogo (`GET /agents?account_id=`) e o painel de execução usam essa conta. O cartão mostra "Conta: <nome>" ou "Sem conta".

## Recuperação de execuções RUNNING

- Uma análise dura segundos. `RUNNING` com mais de 10 minutos foi interrompido (processo reiniciado, falha a meio).
- Essas execuções passam a `FAILED` com mensagem explícita (`STALE_RUN_MESSAGE`). Acontece ao listar o catálogo, listar execuções, consultar uma execução e antes de criar nova execução da mesma conta.
- Não há reexecução automática. Não há exclusão: o histórico fica. Só afeta o tenant da chamada.


## Prontidão por agente (levantamento de 2026-11-21)

Verificado no código. Só "pronto para construir" avança sem decisão adicional.

| Agente (público) | Serviços a reutilizar | Dados que faltam | Situação |
|---|---|---|---|
| Gestor | `Analista` (consolidação) | — | implementado |
| Analista | `MarginService` (implementado); Mix Ativo: estoque/Full/ruptura via `products` (stock_quantity manual) | estoque e Full do Mercado Livre não sincronizados; ruptura exige dados de anúncio | margem implementada; estoque/Full pendente |
| Anúncios (Vitrine Farma) | `products`; margem do Analista para preços | anúncios do Mercado Livre não sincronizados; Buy Box sem API confirmada | não iniciado; Buy Box só documentação |
| Criativo | nenhum | conteúdos e serviços próprios | não iniciado |
| ADS (Giro Ads) | `AdsService` (importação CSV e resumo) | receita atribuída às campanhas (ROAS/ACOS); margem após publicidade (decisão pendente) | implementado (leitura) |
| SAC (Balcão Digital) | nenhum | perguntas e mensagens não sincronizadas; allowlist de observação não as cobre | só documentação até confirmar APIs e políticas |

Regras para avançar:
1. Cada agente novo começa em modo de recomendação, com o contrato do Gestor e do Analista: execução registada, estados reais, fontes e premissas.
2. Allowlist de observação: estender só para leitura, com aprovação explícita e teste de que escritas continuam bloqueadas.
3. Não recalcular: qualquer análise financeira nova vai para o Analista; o Gestor só consolida.

## Giro Ads (ADS) — implementado em `feature/office-agent-giro-ads`

Dados disponíveis: `ads_costs` (CSV importado: data, valor, SKU opcional, campanha opcional). Não há vendas atribuídas, cliques nem impressões nos dados. Por isso:

- Investimento, período, origem (linhas e ficheiros) e distribuição por SKU e campanha vêm das linhas importadas da própria conta.
- **ROAS = receita atribuída ÷ investimento** e **ACOS = investimento ÷ receita atribuída × 100** são funções puras testadas. Sem receita atribuída confiável, devolvem `null` e a UI mostra "indisponível" com o motivo. Nenhum valor é estimado.
- Vendas orgânicas não são atribuídas à publicidade. Receita de campanhas não é tratada como lucro. O investimento não é misturado com o DRE.

Regras explícitas (limites no código, `ADS_RULES`):
- Gasto sem SKU acima de 20% do investimento: risco. Abaixo: pendência.
- Uma campanha acima de 50% do investimento: concentração (informativo).
- Investimento em SKU com alerta de margem no último resultado concluído do Analista: risco, com recomendação de **revisão** (nunca de pausa, aumento de verba ou alteração).
- Sem resultado concluído do Analista: pendência "margem não avaliada", sem cruzamento inventado.

Estados: BLOCKED `SEM_DADOS_ADS` (conta sem linhas importadas) ou `CONTA_DESCONECTADA`. Nunca um resultado com zero no lugar de ausência de dados.

## Gestor como mesa de reunião

O Gestor não recalcula. Lê a última execução persistida de cada agente da conta (Analista e ADS) e devolve em `consolidation.mesa`:
- estado real de cada agente: Nunca executado, Em execução, Concluído, Bloqueado, Falhou;
- data e identificador da execução usada (origem);
- achados principais, problemas (riscos), prioridades (riscos primeiro, máximo cinco), recomendações e pendências de dados.

Sem nenhum resultado concluído: BLOCKED `SEM_RESULTADOS`, sem números.

## Correspondência de implementação (reconciliada em 2026-11-21)

| Público | Estado real | Como executar |
|---|---|---|
| Gestor | implementado | `POST /agents/central-farma/runs` |
| Analista | implementado (margem) | `POST /agents/dose-certa/runs` |
| Anúncios | não implementado | — |
| Criativo | não implementado | — |
| ADS | implementado (leitura) | `POST /agents/giro-ads/runs` |
| SAC | não implementado (só documentação) | — |

Antes desta reconciliação, a secção "Prontidão" e o checkpoint 23 diziam que o ADS não estava implementado. Ficam corrigidos aqui e no checkpoint 26.

## Anúncios (Vitrine Farma) — prontidão após o ADS

Reutilizável: `products` (cadastro, `stock_quantity` manual), `MarginService` para preços e promoções. Falta: anúncios do Mercado Livre não são sincronizados, e Buy Box exige confirmação de API oficial e escopos. Não iniciar sem essa confirmação.

