# Decisões arquiteturais

## ADR-021 — Anúncios sobre o catálogo local, sem escopos novos e sem custo legado

**Contexto:** o agente Anúncios deveria cuidar do catálogo e dos preços. Os anúncios publicados e o Buy Box exigem APIs do Mercado Livre não confirmadas, e possivelmente escopos novos. Existe um cadastro local (`products`) com um campo `cost_price` legado, sem regra de publicação.

**Decisão:**
- Análise determinística do catálogo local, restrita aos SKUs que a conta vendeu. Os produtos são do tenant; a conta limita o escopo pelas vendas.
- Custo só de `product_costs` APPROVED da conta. O campo legado não é usado, e um teste garante isso.
- Nenhuma chamada ao Mercado Livre, nenhum escopo novo, Buy Box declarado como não avaliado.

**Alternativas rejeitadas:** usar `cost_price` (sem regra de publicação, diverge do custo aprovado); sincronizar anúncios sem API confirmada (risco de dados inventados e de escopo não aprovado).

**Consequências:** o agente não vê anúncios publicados nem preços efetivos no Mercado Livre. Os achados dizem respeito ao cadastro do utilizador, e a interface declara isso.
 — importação de CSV de publicidade em duas fases, tudo ou nada, sem bibliotecas

**Contexto:** o investimento em publicidade chega por relatório CSV exportado pelo utilizador. Um ficheiro com erros não pode deixar dados parciais; o utilizador precisa de ver o resumo antes de gravar; e o parser não tinha campos entre aspas.

**Decisão:**
- Duas fases: pré-visualização (valida, resume e avisa, sem gravar) e confirmação (mesmo ficheiro, mesma validação, gravação idempotente por hash e linha).
- Tudo ou nada: qualquer linha inválida rejeita o ficheiro, e a interface mostra todos os erros com o número da linha.
- Campos entre aspas tratados por um separador próprio e testado; campos com quebra de linha recusados explicitamente.
- A interface valida extensão, tamanho e vazio no navegador; o servidor valida o restante. O ficheiro nunca sai da API própria.
- Reimportação do mesmo ficheiro não duplica (idempotente, sem confirmação).
- Ficheiro diferente com linhas que coincidem (dia, SKU, campanha, valor) com despesas já importadas de outro ficheiro: exige confirmação explícita do ADMIN, validada no servidor (409 sem ela). A confirmação e as contagens ficam registadas em `ads_import_batches`. Nenhuma linha é eliminada automaticamente, porque despesas legítimas podem ter valores iguais.
- Correspondência 1 para 1 entre linhas (multiconjunto): uma linha existente só coincide uma vez.

**Alternativas rejeitadas:** importação parcial (deixa dados inconsistentes); deduplicação automática por conteúdo (apaga despesas legítimas repetidas no mesmo dia); bloquear reexportações sem possibilidade de confirmação (impede correções legítimas); biblioteca de CSV (uma dependência para um formato simples).

Detalhe: `docs/prontidao-operacional-agentes.md`.

## ADR-019 — Giro Ads sem ROAS/ACOS inventados; Gestor só consolida resultados persistidos

**Contexto:** o escritório precisa de um agente de publicidade (ADS) e de um Gestor que consolide os agentes. Os dados ADS existentes são custos importados por CSV (data, valor, SKU opcional, campanha opcional). Não há vendas atribuídas às campanhas.

**Decisão:**
- O Giro Ads apresenta investimento, período, origem e distribuição a partir das linhas importadas da própria conta.
- ROAS e ACOS são calculados apenas com receita atribuída confiável. Sem essa receita, ficam `null` e a UI mostra "indisponível" com o motivo. Não há estimativa nem zero no lugar de ausência.
- Investimento ADS não entra no DRE nem é tratado como lucro. Vendas orgânicas não são atribuídas à publicidade.
- O cruzamento com a margem usa a última execução concluída do Analista (persistida). O ADS não recalcula margem.
- O Gestor não recalcula nenhum agente: lê a última execução persistida de cada um e consolida, com estado, data e origem.

**Consequências:** o Giro Ads só mostra retorno quando houver uma fonte de receita atribuída validada. Até lá, a análise é de investimento e de cruzamento com margem. Qualquer fonte nova de dados (relatórios de campanhas do Mercado Livre) exige decisão própria sobre escopos e permissões, e não entra por esta via.

**Alternativas rejeitadas:** estimar receita atribuída a partir de vendas do SKU (inventa atribuição); somar ADS ao DRE (mistura regimes sem regra aprovada); recalcular margem no Gestor (duplica cálculo).

Detalhe: `docs/agentes-escritorio.md`, secções "Giro Ads" e "Gestor como mesa de reunião".

## ADR-018 — agentes operacionais: execução determinística, só leitura, estado vindo do backend

**Contexto:** o escritório mostrava agentes com estados fixos ("Ativo", "Bloqueado") sem nenhuma execução por trás. A Diretiva Mestre exige agentes que trabalhem sobre dados reais, com estados reais e sem respostas inventadas.

**Decisão:** o primeiro agente operacional (Central Farma) é uma função pura sobre serviços de leitura já existentes (margem por SKU, alertas, variação de taxa). Cada execução é gravada em `agent_runs` com estado, bloqueio, fontes e resultado. Não há modelo de linguagem. A UI só mostra estados presentes na base de dados. Agentes sem implementação são recusados pela API e aparecem como "Ainda não implementado".

**Consequências:** a análise é reproduzível a partir dos mesmos dados. Limitação: depende de dados sincronizados e não reconcilia liquidações (a margem não é DRE). Ações comerciais continuam fora de escopo e exigem um gate próprio.

**Alternativas rejeitadas:** usar um LLM para redigir recomendações (respostas não verificáveis e custo sem autorização); fila de jobs nesta fase (complexidade sem ganho para uma análise de leitura); manter estados visuais fixos (fabricação de estado).

Detalhe: `docs/agentes-escritorio.md`.

## ADR-017 — sincronização de pedidos retomável e idempotente

**Contexto:** o sincronizador anterior acumulava todas as páginas em memória e só gravava ao final. Com 50 pedidos por página e quatro páginas por job, contas com mais de 200 pedidos falhavam com `ORDER_SYNC_INCOMPLETE` e terminavam com zero pedidos importados.

**Decisão:** cada execução processa uma página e grava a página junto com o avanço do cursor na mesma transação. O cursor é isolado por `tenant_id`, `marketplace_account_id` e operação. A continuação é agendada no BullMQ com identificador determinístico por conta e offset.

**Integridade:** pedidos usam upsert por tenant, conta e identificador externo do Mercado Livre. `COMPLETE` só é gravado quando `next_offset >= expected_total`; caso contrário, o estado permanece `PARTIAL`. Falhas guardam somente códigos sanitizados, nunca tokens ou payloads completos.

**Alternativas rejeitadas:** aumentar indiscriminadamente o limite de páginas; declarar sucesso com cobertura parcial; apagar a fila falha; ou recomeçar sempre do offset zero.

**Consequências:** a sincronização pode atravessar vários jobs, o relatório precisa mostrar cobertura e lacunas, e uma migration cria o estado persistente. A paginação por offset ainda deve usar uma janela temporal estável ou cursor oficial quando o adaptador Mercado Livre suportar esse contrato.

**Escopo de segurança:** o adaptador continua somente leitura em `OBSERVATION`; OAuth e refresh permanecem permitidos, mas nenhuma escrita comercial é introduzida.

**Repetição de 429 do Mercado Livre no cliente (2026-11-21, `d8448e5`):** o pedido repete até 3 vezes, com espera por `Retry-After` ou backoff de 2, 4 e 8 s e teto de 10 s. Motivo: as falhas concentravam-se num tick agendado com `attempts: 1`, que só voltava a tentar 15 min depois. Efeito conhecido: até ~30 s de espera por pedido, numa fila sem `concurrency` configurada. Valores heurísticos, não confirmados pela documentação do ML.

**Painéis sem dados não mostram estados (2026-11-21):** a página `/escritorio` mostrava estados fixos ("Ativo", "Bloqueado") sem ligação a execuções. Passou a mostrar "Offline" com legenda explícita de que nenhum estado é medido. Regra: interface sem dados reais não exibe estado inventado.


**Sem prefetch em rotas protegidas (2026-11-21, `975cfa3`):** a barra lateral usa `prefetch={false}`. O refresh de sessão é de uso único e a API revoga a sessão na reutilização; prefetches concorrentes com o mesmo refresh token derrubavam a sessão. Regra: navegação para rotas protegidas não faz prefetch.

**Verificação de restauro = mesma lista que o arranque da API (2026-11-21, `888bdd2`):** a contagem de tabelas RLS esperadas usa a lista canónica de 17 tabelas, igual a `prisma.service.ts`. Qualquer tabela nova com RLS entra nas duas listas.

**Conta dentro de pedidos é resumida (2026-11-21, `45ebcdd`):** `orderAccountSelect` (id, nome, plataforma, estado) em `publicOrderSelect`. Identidade fiscal (`cnpj`, `businessName`, `externalSellerId`, `displayName`) só em `publicAccountSelect`, usado pela área de integrações do mesmo tenant.
