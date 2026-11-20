# DRE — 7 Decisões de Negócio (Farmaecon Pro)

_2026-11-18_

> Cópia versionada do documento de decisão (Claude Docs). Preencher o campo
> **Decisão** de cada secção. Depois de decididas, alinhar esta cópia, o
> `CLAUDE.md` e a spec do DRE.

## Contexto

Estas 7 decisões são o único gate que bloqueia a publicação de custos no DRE.
Enquanto não estiverem decididas, todo documento de compra ingerido fica em
`pending_review` e nunca escreve em `product_costs` — ou seja, não há CMV final
nem lucro real, só a prévia indicativa.

O motor já está construído e provado em Postgres real (ingestão, vínculo por
CNPJ, matching de custo, prévia do DRE). O que falta não é código: é a **regra
de negócio** que diz como calcular e quando publicar. Cada secção abaixo traz a
pergunta, o que já existe no sistema, as opções com o que cada uma custa, a
recomendação (quando há uma), e um campo **Decisão** para preencher.

Regra de ouro mantida: nada é publicado sem regra aprovada. Depois de decidir,
prepara-se o plano de implementação — sem qualquer deploy em produção sem OK
explícito.

> Nota de privacidade: este documento não inclui CNPJ, CPF, chaves fiscais nem
> valores reais de documentos. Os números de NF-e (ex.: 1926966) são apenas
> referências internas para identificar o caso; os valores nos exemplos são
> ilustrativos.

## Decisão 1 — Documento → conta ML

**Pergunta:** como ligar cada documento de compra à conta ML certa, e o custo é
por conta ML ou por empresa (CNPJ)?

**Já construído:** o sistema liga automaticamente por CNPJ — só quando o CNPJ do
destinatário é válido (DV), exato e único entre as contas do tenant. Dois+ com o
mesmo CNPJ → `ambiguous`; CNPJ diferente → `cnpj_no_match`; sem CNPJ válido →
fica pendente. O nome nunca confirma sozinho (só sugere). Casos não resolvidos
ficam para seleção manual (serviço pronto; falta só o botão na UI de revisão).

**O que falta decidir:**

1. **Base do custo — por conta ou por empresa.** Uma empresa pode ter várias
   contas ML com o mesmo CNPJ. Hoje o matching é por conta. Se o custo for por
   empresa, documentos de qualquer conta da mesma empresa alimentam o mesmo pool
   de custo.
2. **Política para casos sem CNPJ ou ambíguos.** Confirmar que ficam sempre em
   revisão manual (nunca auto-vinculados por nome)?

| Opção | O que implica | Custo se errado |
| --- | --- | --- |
| Custo **por conta ML** (atual) | Cada conta tem o seu pool de custos; mais granular | Se a mesma compra serve várias contas, o custo não é partilhado |
| Custo **por empresa (CNPJ)** | Pool único por empresa; reflete a compra real | Perde-se granularidade por conta; exige agregar contas do mesmo CNPJ |

**Recomendação:** manter auto-vínculo só por CNPJ e revisão manual no resto
(seguro, sem falsos positivos). Para a base do custo, inclinação para **por
empresa (CNPJ)**, por refletir a compra fiscal real — mas é a tua chamada.

**Decisão:** _______________

## Decisão 2 — Regra de bonificação (a mais crítica)

**Pergunta:** quando o fornecedor dá unidades bonificadas (grátis), como se
calcula o custo unitário?

**Porque é a mais importante:** a spec contradiz-se. A secção F (fórmula geral)
diz **pago + despesas ÷ unidades**; a secção H (exemplo da NF-e 1926966) diz
**pago + bonificado ÷ unidades**. São resultados diferentes. Isto não se resolve
sozinho — é decisão de negócio pura. Casos de referência: NF-e 1926966 e
1885505.

**Já construído:** o `bonus-calc.ts` não escolhe — devolve os 3 candidatos lado
a lado, cada um com fórmula legível e `status: 'estimado / pendente de
aprovação'`. Nunca devolve custo zero: sem base paga → `null`.

Exemplo ilustrativo: pago R$ 100, 10 unidades pagas + 2 bonificadas (12 no
total).

| Candidato | Fórmula | Custo unit. (exemplo) | Leitura |
| --- | --- | --- | --- |
| `rateio_proporcional_valor_nominal` | (pago + valor bonificado) ÷ unidades totais | ~R$ 10,00 | Bonificação entra como valor; dilui no total |
| `bonificacao_dilui_custo` | pago ÷ unidades totais | ~R$ 8,33 | Pago espalha-se por todas as unidades (incl. grátis) |
| `bonificacao_sem_custo` | pago ÷ só unidades pagas | R$ 10,00 pagas / indisponível nas grátis | Bonificadas ficam sem custo atribuído |

**Recomendação:** nenhuma — esta é tua. É preciso escolher **um** dos três e
dizer se a secção F ou a H da spec é a correta (para alinhar a documentação).

**Decisão:** _______________

## Decisão 3 — Tratamento do `vOutro` (outras despesas)

**Pergunta:** as "outras despesas" da nota (frete, seguro, encargos — campo
`vOutro`) entram no custo do produto ou ficam à parte?

**Já construído:** o parser já extrai `vOutro` por nota e por linha; o valor está
guardado. Só não é aplicado ao custo até haver regra.

| Opção | O que implica | Custo se errado |
| --- | --- | --- |
| Rateia no custo | Despesas distribuídas pelas unidades → custo mais próximo do real desembolsado | Se forem despesas não-recuperáveis mas não-de-produto, inflaciona o CMV |
| Fica à parte | Custo do produto = só mercadoria; despesas tratadas separadamente no DRE | CMV subestimado face ao desembolso real |

**Recomendação:** ratear no custo quando o `vOutro` for diretamente atribuível à
compra (regra contábil tua). É preciso confirmar a regra e se há tipos de
despesa a excluir.

**Decisão:** _______________

## Decisão 4 — `vProd` bruto vs `vItem` líquido (com desconto)

**Pergunta:** a base do custo unitário é o valor bruto do produto (`vProd`) ou o
valor líquido depois do desconto da linha (`vProd − vDesc`)?

**Já construído:** o parser extrai `vProd`, `vDesc` e `vOutro` por linha — as
duas bases estão disponíveis. Falta decidir qual alimenta o custo.

| Opção | O que implica | Custo se errado |
| --- | --- | --- |
| `vProd` bruto | Custo = preço de tabela; ignora descontos | Sobrevaloriza o custo → margem subestimada |
| Líquido (`vProd − vDesc`) | Custo = o que de facto pagaste pela linha | Se o desconto for condicional/temporal, pode variar entre notas |

**Recomendação:** usar o **líquido** (`vProd − vDesc`), por ser o custo
efetivamente pago — coerente com a lógica de "pago" da bonificação. Confirmar,
sobretudo se há descontos que não devam reduzir o custo registado.

**Decisão:** _______________

## Decisão 5 — Vigência da planilha ML GERAL

**Pergunta:** a partir de que data o custo de uma planilha de custos passa a
valer para o cálculo do CMV?

**Já construído:** o matching escolhe o custo "mais recente antes da venda"
(`resolveCostCandidate`), usando a data de import como proxy (`createdAt`);
`soldAt = mlDateCreated ?? createdAt`. Ou seja, a vigência hoje é a data de
importação, não uma data de negócio declarada.

| Opção | O que implica | Custo se errado |
| --- | --- | --- |
| Vigência = data de import (atual) | Simples; o custo vale a partir de quando foi carregado | Vendas anteriores ao import não apanham o custo certo; retroatividade perdida |
| Vigência = data declarada na planilha | O custo vale a partir da data de negócio (ex.: início do mês) | Exige um campo de vigência na planilha e regra de sobreposição entre planilhas |

**Recomendação:** adotar uma **data de vigência explícita** por planilha (com
fallback para a data de import), para o CMV ser reproduzível. É preciso definir:
a planilha traz essa data? Vale do início do mês? Como tratar sobreposições.

**Decisão:** _______________

## Decisão 6 — Código de fornecedor 5080 ↔ SKU

**Pergunta:** como mapear o código de produto do fornecedor (ex.: 5080) para o
SKU do Mercado Livre, para o custo casar com a venda?

**Já construído:** o matching tenta, por ordem, EAN → SKU → código de fornecedor
→ descrição normalizada. Os itens de pedido ML não têm EAN, por isso na prática
o casamento cai muito em SKU/descrição. O código de fornecedor só ajuda se
existir um de-para.

| Opção | O que implica | Custo se errado |
| --- | --- | --- |
| Tabela de-para fornecedor→SKU | Casamento exato e auditável | Exige manter a tabela atualizada por fornecedor |
| Só por descrição normalizada | Sem tabela extra | Falsos positivos/negativos; custo indisponível ou errado |

**Recomendação:** criar e manter um **de-para código-fornecedor → SKU** (pelo
menos para os fornecedores principais). É preciso dizer: existe essa tabela
hoje? Em que formato? Quem a mantém?

**Decisão:** _______________

## Decisão 7 — Quantidade "dd" de abril

**Pergunta:** a quantidade marcada como "dd" num documento de abril é uma
anomalia de dados — qual é o valor correto?

**Já construído:** nada a decidir no código; é um caso de dado de origem. O
parser regista a quantidade como vem e sinaliza em `extraction_warnings`; o
documento fica em `pending_review` e não contribui custo enquanto não for
resolvido.

**O que verificar:** confirmar na origem (documento real / fornecedor) qual a
quantidade correta, ou a regra para interpretar "dd". Não se inventa valor — ou
corriges o dado, ou defines a regra de interpretação.

**Recomendação:** tratar como correção de dado pontual (não como regra de
sistema), a menos que "dd" apareça com frequência — nesse caso vale uma regra de
normalização.

**Decisão:** _______________

## Como registar as decisões e próximos passos

**Como decidir:** preencher o campo **Decisão** de cada secção. A Decisão 2
(bonificação) é a que mais bloqueia — se só houver tempo para uma, começar por
essa.

**O que acontece depois de decidir:**

1. Alinhar a documentação (`CLAUDE.md` + spec do DRE) com as regras escolhidas,
   incluindo resolver a contradição F/H.
2. Preparar o plano de implementação das regras (cálculo de CMV, publicação de
   `product_costs` com `cost_allocation_rules`), por TDD, sem tocar em produção.
3. Validar no ensaio (Postgres real, imagens CI) antes de qualquer proposta de
   deploy.
4. Só depois, e só com OK explícito (backup + rollback), se põe em produção.

**Estado atual (contexto):** DRE + Partes A/B integrados em
`feature/merge-ml-resumable-sync`, CI verde, 0 PRs abertas, produção intocada em
modo OBSERVATION. Este gate de negócio é o que falta para avançar do
"observação" para o "DRE gerencial com custo real".
