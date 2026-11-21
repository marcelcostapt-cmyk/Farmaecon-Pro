# Decisões arquiteturais

## ADR-017 — sincronização de pedidos retomável e idempotente

**Contexto:** o sincronizador anterior acumulava todas as páginas em memória e só gravava ao final. Com 50 pedidos por página e quatro páginas por job, contas com mais de 200 pedidos falhavam com `ORDER_SYNC_INCOMPLETE` e terminavam com zero pedidos importados.

**Decisão:** cada execução processa uma página e grava a página junto com o avanço do cursor na mesma transação. O cursor é isolado por `tenant_id`, `marketplace_account_id` e operação. A continuação é agendada no BullMQ com identificador determinístico por conta e offset.

**Integridade:** pedidos usam upsert por tenant, conta e identificador externo do Mercado Livre. `COMPLETE` só é gravado quando `next_offset >= expected_total`; caso contrário, o estado permanece `PARTIAL`. Falhas guardam somente códigos sanitizados, nunca tokens ou payloads completos.

**Alternativas rejeitadas:** aumentar indiscriminadamente o limite de páginas; declarar sucesso com cobertura parcial; apagar a fila falha; ou recomeçar sempre do offset zero.

**Consequências:** a sincronização pode atravessar vários jobs, o relatório precisa mostrar cobertura e lacunas, e uma migration cria o estado persistente. A paginação por offset ainda deve usar uma janela temporal estável ou cursor oficial quando o adaptador Mercado Livre suportar esse contrato.

**Escopo de segurança:** o adaptador continua somente leitura em `OBSERVATION`; OAuth e refresh permanecem permitidos, mas nenhuma escrita comercial é introduzida.

**Repetição de 429 do Mercado Livre no cliente (2026-11-21, `d8448e5`):** o pedido repete até 3 vezes, com espera por `Retry-After` ou backoff de 2, 4 e 8 s e teto de 10 s. Motivo: as falhas concentravam-se num tick agendado com `attempts: 1`, que só voltava a tentar 15 min depois. Efeito conhecido: até ~30 s de espera por pedido, numa fila sem `concurrency` configurada. Valores heurísticos, não confirmados pela documentação do ML.

**Painéis sem dados não mostram estados (2026-11-21):** a página `/escritorio` mostrava estados fixos ("Ativo", "Bloqueado") sem ligação a execuções. Passou a mostrar "Offline" com legenda explícita de que nenhum estado é medido. Regra: interface sem dados reais não exibe estado inventado.
