# Escritório de agentes — arquitetura mínima (primeiro incremento)

Estado: branch `feature/office-agents-mvp` (a partir de `integration/pr12-main-reconciliation` @ `d9ba6f2`).
Não está em produção. Modo do produto: `OBSERVATION` (leitura).

## Dois tipos de "agente" — não confundir

| Tipo | Onde vive | Para quê |
|---|---|---|
| Subagentes de desenvolvimento | `.claude/agents/` (fora do repositório versionado) | Ajudam a construir o código no Claude Code. |
| Agentes operacionais do produto | `apps/api/src/modules/agents/` e `/escritorio` | Analisam dados reais de uma conta do Mercado Livre e registam o resultado. |

Só os segundos fazem parte do produto. Nenhum deles executa uma ação no Mercado Livre.

## Nomes e correspondência

A interface pública segue o design C2 (`docs/design/tokens.css`, acentos `--fa-ag-*`): **Gestor, Analista, Anúncios, Criativo, ADS e SAC**. Os nomes da Diretiva Mestre são identificações internas. Correspondência 1:1, sem duplicações; a mesma tabela está em `apps/api/src/modules/agents/agent-catalog.ts`.

| Nome público (C2) | Chave técnica | Nome interno (Diretiva) | Responsabilidade | Estado |
|---|---|---|---|---|
| Gestor | `central-farma` | Central Farma | orquestração e análise financeira de leitura por conta | **implementado** |
| Analista | `dose-certa` | Dose Certa | preço, custo, CMV e rentabilidade | não implementado |
| Anúncios | `mix-ativo` | Mix Ativo | revisão de anúncios e promoções com base na margem validada | não implementado |
| Criativo | `vitrine-farma` | Vitrine Farma | briefings, imagens e infográficos para anúncios | não implementado |
| ADS | `giro-ads` | Giro Ads | campanhas e verba (depende de ADS na margem) | não implementado |
| SAC | `balcao-digital` | Balcão Digital | classificação de solicitações e rascunhos com revisão humana | não implementado |

Pontos a confirmar antes de construir:
- **Full e estoque.** A referência C2 atribui ruptura e Full ao Analista; a Diretiva atribui estoque, giro e Full ao Mix Ativo (Anúncios). Hoje nenhum dos dois existe.
- A chave técnica `central-farma` não muda: é a rota e o registo já em produção de ensaio.

A referência anterior (`.claude/referencias-farmaecon-pro.md`) usava Gestor, Analista, Anúncios, Criativo, ADS e SAC com a mesma lista de funções; a correspondência acima segue essa referência.

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

