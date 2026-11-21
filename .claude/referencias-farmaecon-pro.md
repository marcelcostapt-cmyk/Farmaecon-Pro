# Referências de mercado vs Farmaecon Pro

> Data: 2026-11-20 · Branch: `feature/westack-margin-manager` (HEAD `cd6b2d8`) · Sem PRs abertos.
> Fonte: apenas conteúdo público das páginas (sem login, sem scraping). Nenhum texto, marca, layout ou código foi copiado; as referências servem só de inspiração de escopo.
> Limitação: o MercadoTurbo renderiza no browser e a resposta HTML veio vazia (só o título). Essa coluna está **incompleta** e foi complementada com uma pesquisa de terceiros pouco fiável.

---

## 1. Diagnóstico do estado atual

- **Working tree:** pastas `.claude/agents/`, `.claude/prompts/`, `.claude/skills/`, `docs/diagnostico-producao.md`, `docs/quality.md`, `docs/setup.md` e `memoria/` ainda não estão no git (untracked). O prompt de modelação agora está limpo, com a cerca de fecho.
- **Produção:** `94612a9` (Via 1, 2026-11-19), modo **OBSERVATION** (só leitura sobre o Mercado Livre). Contas ML sincronizam, mas a margem e o DRE ficam "indisponível" até os custos serem publicados.
- **Bloqueio principal:** a publicação de custos reais depende de 7 decisões de negócio do Márcio (ver `CLAUDE.md`). Sem isso não há CMV real em produção.
- **Já existe no código (API e web):** auth e tenants, contas ML com OAuth/PKCE, refresh de tokens, sync de pedidos (com `saleFee`, `paidAmount`, `payments`), dashboard, finanças (despesas manuais), margem líquida por SKU com alertas e regras (`/margin/*`), pipeline de NF-e (XML) com bonificação, DRE preview e publicação de custos.
- **Gaps de nicho:** o schema não tem campos de **lote, validade ou registo Anvisa**. Os lotes existem só no parser de NF-e (`lots`), sem persistência ligada ao custo publicado. Não há estoque.
- **Gap de canal:** só Mercado Livre. Não há Shopee, Amazon, Magalu, Bling/Olist nem ADS.

---

## 2. Catálogo de funcionalidades por site

### 2.1 Letzee (`letzee.ai/software-de-gestao-para-mercado-livre/`)
- **Posicionamento:** lucro por anúncio no Mercado Livre, com tarifas, ADS, impostos, frete e custo descontados por venda. App certificado pelo ML.
- **Funcionalidades públicas:** margem por venda e por anúncio com cálculo aberto; ranking de heróis e vilões (margem após ADS, faturamento, quantidade); Central de Marketing (margem de cada promoção antes de entrar, participação em lote); visão consolidada de várias contas; histórico acumulado desde a conexão; alerta quando o ML muda tarifa ou frete; planeamento de reposição do Full; custos via Bling/Olist ou planilha; extensão Chrome/Edge; integração com IA (Claude, ChatGPT).
- **Público:** vendedores ML com faturamento de R$100 mil a R$500 mil/mês.
- **Limitações públicas:** o ML só entrega 90 dias de dados completos; o histórico anterior não é recuperável.
- **Modelo:** trial de 15 dias, sem cartão. Planos a partir de R$59 e R$99/mês.

### 2.2 MercadoTurbo (`www.mercadoturbo.com.br`)
- **Conteúdo obtido:** só o título "Gestão e Automação para Mercado Livre". A página é uma SPA sem conteúdo no HTML.
- **Pesquisa de terceiros (secundária, não confirmada):** monitorização de anúncios, acompanhamento de concorrentes, modelos de mensagens para clientes, planos gratuito e pagos, sem API pública.
- **Estado:** catálogo **incompleto**. Para o completar é preciso um browser real (não foi feito aqui).

### 2.3 Joddaia (`joddaia.com.br`)
- **Posicionamento:** "inteligência de lucro pedido a pedido" para sellers profissionais, em vários canais (ML, Shopee, Amazon, Magalu, TikTok Shop, Shein).
- **Funcionalidades públicas:** painel de lucro (faturamento, lucro, margem, impostos, ADS, margem pós-ADS; filtros por período, canal, conta, CNPJ); análise de pedidos com custo, comissão, frete e tributos pelo regime do CNPJ; gestão de produtos e custos; ADS e promoções pelo lucro (inclui lucro de cada promoção ML vs meta); finanças; integrações diretas (ML, Shopee, Amazon) e via ERP (Bling, Tiny, UpSeller); extensão Chrome com lucro ao lado de cada venda; MCP para assistentes de IA (Claude/ChatGPT); operações com vários CNPJs; campanhas por IA e automação de promoções.
- **Público:** sellers profissionais, multi-CNPJ, quem usa ERP, agências.
- **Limitações públicas:** taxas estimadas na Amazon que "se acertam sozinhas"; Magalu com prévia antes da entrega.
- **Modelo:** planos mensais de R$97,90 a R$549,90 por faixa de pedidos (500 a 10.000+), com desconto anual.

### 2.4 WeStack (`westack.com.br`)
- **Posicionamento:** "escritório virtual de automações" com um squad de agentes para ML: gestor, analista (preço, Buy Box, ruptura, Full), anúncios (catálogo e promoções), criativo, ADS e SAC.
- **Funcionalidades públicas:** execução autónoma de ações dentro de regras de margem (repricing de catálogo, migração de promoção, cupom para carrinho abandonado, oferta relâmpago); relatório diário com antes/depois confirmado pelo ML; escalonamento para aprovação quando passa do limite de autonomia; resposta a perguntas e SAC.
- **Público:** vendedores ML que querem operar sem equipa (cita custo de R$3k a R$5k por vaga).
- **Limitações públicas:** a demonstração é gratuita; casos de estudo com números não verificáveis por nós.

### 2.5 Matriz de categorias públicas (✓ anuncia · ? implícito/incerto · - não menciona)

| Funcionalidade | Categoria | Letzee | MercadoTurbo | Joddaia | WeStack | Observação |
|---|---|---|---|---|---|---|
| Margem líquida por venda/pedido (taxas, frete, tributos, CMV) | Finanças | ✓ | ? | ✓ | - | Core de todos os concorrentes |
| Margem após ADS | Finanças | ✓ | ? | ✓ | ✓ (ADS) | Requer dados de ADS |
| Painel de lucro consolidado (período, conta, CNPJ) | Relatórios / BI | ✓ | ? | ✓ | ✓ (relatório diário) | |
| Heróis e vilões (ranking por margem) | Relatórios / BI | ✓ | ? | ? | - | Quick win sobre dados existentes |
| Histórico acumulado desde a conexão | Relatórios / BI | ✓ | - | ✓ | - | Sync contínuo já existe |
| Custos via planilha / importação | Finanças / custos | ✓ | - | ✓ | - | Farmaecon: pipeline NF-e |
| Custos via ERP (Bling, Olist, Tiny) | Integrações | ✓ | - | ✓ | - | Farmaecon: sem integração |
| Multi-conta / multi-CNPJ | Gestão | ✓ | ? | ✓ | - | Farmaecon: multi-conta sim, CNPJ por conta |
| Alerta de mudança de tarifa ML | Automação / regras | ✓ | - | ? | - | Requer histórico de `saleFee` |
| Central de promoções com margem mínima | Anúncios | ✓ | ? | ✓ | ✓ | Requer escrita no ML (hoje bloqueada) |
| Repricing / ações automáticas | Automação | - | ? | ✓ (campanhas) | ✓ | Conflita com modo OBSERVATION |
| Reposição / planeamento Full | Estoque | ✓ | - | - | ✓ (Analista) | Sem estoque no Farmaecon |
| Ruptura de estoque | Estoque | - | - | - | ✓ | Sem estoque |
| Gestão de anúncios e monitorização de concorrentes | Anúncios | - | ✓ | - | ✓ | |
| Respostas a perguntas / SAC automático | Suporte | - | ✓ | - | ✓ | |
| Extensão Chrome | Integrações | ✓ | - | ✓ | - | |
| Integração com assistentes de IA / MCP | Integrações | ✓ | - | ✓ | - | |
| Criativos e imagens (infográficos, selos) | Anúncios | - | - | - | ✓ | Fora do escopo do produto |
| Multi-marketplace (Shopee, Amazon, Magalu, Shein) | Integrações | - | - | ✓ | - | Farmaecon: só ML |
| Lote, validade e Anvisa | Nicho farmácia | - | - | - | - | **Nenhum concorrente público fala disto** |
| Custos de bonificação e NF-e com CNPJ | Nicho fiscal | - | - | ? | - | Farmaecon: diferenciador já construído |

---

## 3. Matriz Farmaecon Pro vs Referências

| Funcionalidade | Já existe no Farmaecon? | Estado | Referências que têm | Prioridade |
|---|---|---|---|---|
| Margem líquida por SKU (taxa − CMV) | Sim | Código em prod (`94612a9`), mas sem custos publicados → "indisponível" | Letzee, Joddaia, WeStack | Alta (ativar com dados) |
| Alertas de margem mínima | Sim | `/margin/alerts`, regras globais; por produto falta | Letzee, WeStack | Média |
| CMV real a partir de NF-e | Parcial | Pipeline pronto; publicação bloqueada pelas 7 decisões | Joddaia, Letzee (via ERP) | **Máxima** (destrava tudo) |
| Bonificação e rateio de custo | Sim (preview/publicação) | Construído; regra de negócio pendente | Nenhuma pública | Diferenciador |
| Lote, validade, Anvisa | Não | Só parser de lotes sem persistência | Nenhuma pública | **Alta** (nicho) |
| Painel de lucro consolidado | Parcial | Dashboard + DRE preview; DRE gerencial não existe (`financial_transactions=0`) | Letzee, Joddaia | Média |
| Heróis e vilões por margem | Parcial | Dados existem; falta ranking | Letzee, Joddaia | Alta (quick win) |
| Histórico acumulado | Sim | Sync contínuo desde a conexão | Letzee, Joddaia | — |
| Alerta de mudança de tarifa ML | Não | `saleFee` já persistido por item, falta comparação temporal | Letzee | Média |
| ADS na margem | Não | Allowlist ADS adiada para inc. 2 | Letzee, Joddaia, WeStack | Média (dependência externa) |
| Central de promoções com margem | Não | Exige escrita no ML (modo atual só leitura) | Letzee, Joddaia, WeStack | Baixa agora (gate de segurança) |
| Reposição Full / estoque | Não | Sem dados de estoque | Letzee, WeStack | Baixa |
| Integração Bling/Olist | Não | Sem integração | Letzee, Joddaia | Média |
| Multi-marketplace | Não | Só ML | Joddaia | Baixa (fora do nicho atual) |
| Extensão Chrome / MCP-IA | Não | — | Letzee, Joddaia | Baixa |
| Ações automáticas (repricing, cupons) | Não | Propositadamente bloqueado (OBSERVATION) | WeStack | Fora do escopo por agora |
| Criativos / SAC automático | Não | — | WeStack | Fora do escopo |

---

## 4. Top 8 priorizadas

Critérios: alinhamento com o nicho farmácia (fármacos, validade, lote, Anvisa, CMV, margem), esforço vs impacto, dependências já existentes e diferenciação sem copiar.

### 1. Destravar o CMV real (publicação de custos)
- **Porquê:** é o que torna a margem existente real. Sem ele, a margem é "indisponível" em produção.
- **Esforço:** baixo em código (já construído e validado no ensaio); o gargalo são as 7 decisões de negócio.
- **Dependências:** decisões do Márcio (regra de bonificação, vigência, código fornecedor↔SKU, etc.).
- **Próximo passo:** levar as 7 decisões ao Márcio, com a recomendação de cada uma; sem CRUD novo até lá.

### 2. Lote e validade no custo publicado
- **Porquê:** diferenciador de farmácia que nenhuma referência pública cobre. Custos de lotes diferentes têm margens diferentes.
- **Esforço:** médio. O parser já extrai `lots`; falta persistir em `PurchaseInvoiceItem` e `ProductCost` (migration aditiva) e mostrar no preview.
- **Dependências:** item 1 (publicação); decisão sobre a regra do lote (FIFO ou preço médio).
- **Próximo passo:** spec curta com o modelo de lote e um teste de NF-e sintética com dois lotes.

### 3. Heróis e vilões por margem líquida
- **Porquê:** é o caso de uso mais citado pelos concorrentes e usa dados já persistidos (`saleFee`, custo, receita).
- **Esforço:** baixo. Uma agregação e uma vista de ranking em `/margin/preview`.
- **Dependências:** nenhuma técnica; o valor real depende do item 1.
- **Próximo passo:** endpoint `GET /margin/ranking` com ordenação por margem e por faturamento, reusando `computeMargin`.

### 4. Alerta de mudança de tarifa ML
- **Porquê:** a Letzee vende isto como ganho direto; é um alerta de prejuízo antes de ele acontecer.
- **Esforço:** médio. Comparar `saleFee` por SKU ao longo do tempo e disparar alerta quando a taxa efetiva muda.
- **Dependências:** dados de `saleFee` já sincronizados; nenhuma mudança no ML.
- **Próximo passo:** definir o limiar de variação (p. ex. ±2 pp) e a regra de comparação de janelas.

### 5. Margem por produto nas regras (não só global)
- **Porquê:** farmácia tem margens muito diferentes por categoria (genéricos vs OTC vs dermocosmética). Regra global é pouco útil.
- **Esforço:** baixo. A tabela `margin_rules` já tem `sku` nullable; falta UI e teste.
- **Dependências:** nenhuma.
- **Próximo passo:** UI de regra por SKU na página `/margin/preview`, com teste de precedência (SKU sobrepõe global).

### 6. Painel de lucro consolidado por período, conta e CNPJ
- **Porquê:** o Farmaecon já tem multi-conta e CNPJ por conta; é o que as referências multi-CNPJ prometem.
- **Esforço:** médio. Filtros e agregações sobre `margin` e `dre/preview`.
- **Dependências:** item 1 para valores reais.
- **Próximo passo:** definir o contrato do filtro (período, conta, CNPJ) e reusar o `computeDrePreview`.

### 7. Integração com Bling ou Olist para custos e SKUs
- **Porquê:** é como Letzee e Joddaia eliminam o cadastro manual de custos. É o maior ganho de esforço para o cliente.
- **Esforço:** alto. Integração nova, autenticação própria e mapeamento de SKUs.
- **Dependências:** API do ERP escolhido; decisão de qual ERP primeiro (o cliente-alvo usa Bling ou Olist?).
- **Próximo passo:** levantar com o Márcio qual ERP os clientes usam; spike de 1 dia com a API escolhida.

### 8. ADS na margem pós-ADS
- **Porquê:** é a métrica que mais aparece nas referências (margem depois de mídia).
- **Esforço:** médio-alto e incerto. Depende de API de ADS do ML e da allowlist adiada para o inc. 2.
- **Dependências:** acesso à API de ADS; aprovação de escopo.
- **Próximo passo:** confirmar com o Márcio se o inc. 2 de ADS entra no próximo ciclo; antes disso, só um spike de leitura.

**Fora da lista de propósito:** repricing automático, cupons, promoções com escrita no ML e SAC automático. São o diferencial da WeStack, mas exigem sair do modo OBSERVATION e precisam de um gate próprio de segurança.

---

## 5. Próximo passo recomendado

1. **Hoje:** levar ao Márcio as 7 decisões de negócio para desbloquear o CMV real (item 1). É o único passo que muda a margem em produção.
2. **Em paralelo, sem risco:** item 3 (heróis e vilões), que não depende de decisões e usa dados já persistidos.
3. **Depois:** spec de lote e validade (item 2), o diferenciador de farmácia que nenhuma referência pública cobre.

---

## 6. Fontes

- https://letzee.ai/software-de-gestao-para-mercado-livre/ (HTML público, 2026-11-20)
- https://www.mercadoturbo.com.br/ (HTML sem conteúdo; só o título)
- https://joddaia.com.br/ (HTML público, 2026-11-20)
- http://westack.com.br/ (HTML público, 2026-11-20)
- Pesquisa de terceiros sobre MercadoTurbo (secundária, não confirmada): https://www.getapp.com/all-software/a/mercado-turbo/ e https://digitei.com/?p=125354

## 7. Critérios de sucesso

- [x] Os 4 sites lidos apenas no conteúdo público, sem login nem scraping agressivo.
- [ ] MercadoTurbo completo: **não** (HTML vazio; precisa de browser real).
- [x] Catálogo e matriz preenchidos (com a lacuna do MercadoTurbo indicada).
- [x] Top 8 priorizada e justificada.
- [x] Nenhum código, design, marca ou texto copiado.
- [x] Próximo passo pronto para execução.

## 8. Verificação de 2026-11-21 (pesquisa web)

Fonte: resultados de pesquisa web (`WebSearch`) com domínio restrito a cada site. **Não abri as páginas completas**; as afirmações abaixo são as declaradas nos resultados e continuam a ser marketing não verificado.

| Ponto | Situação anterior (secções 2 e 3) | Verificação de hoje |
|---|---|---|
| WeStack: limites de autonomia | Descrito como execução autónoma dentro de regras de margem | Declara um semáforo: verde age sozinho dentro das regras de margem; amarelo pede aprovação no painel; vermelho não age. Rastreabilidade do antes/depois. Alinha-se com os níveis 1 a 4 da diretiva. |
| WeStack: credenciais | Não tratado | Declara aceleração Google for Startups e um mentor do NASA Space Apps. Sem fonte independente. **Não usar como argumento.** |
| MercadoTurbo: DRE | Catálogo incompleto (SPA sem conteúdo) | A página de funcionalidades declara um "Resumo Financeiro e DRE" com tarifa, frete, custo, imposto e lucro líquido, e identificação de anúncios com prejuízo. Também declara margem de contribuição numa extensão de navegador. |
| MercadoTurbo: multicontas | Não tratado | Declara baixa de estoque sincronizada entre contas que vendem o mesmo SKU, troca de conta sem novo login e operadores com 2FA. Relevante para a gestão multi-conta (secção 3, linha de multi-conta). |
| JoddaIA: DRE | Listada como "Finanças", sem confirmação | **Não confirmado.** Nenhuma fonte confirma um módulo de DRE; o menu cita "Finanças" sem detalhe. Não tratar a DRE da Jodda como referência verificada. |

Fontes:
- https://www.westack.com.br/
- https://joddaia.com.br/
- https://joddaia.com.br/calcular-lucro-mercado-livre/
- https://www.mercadoturbo.com.br/funcionalidades/
- https://www.mercadoturbo.com.br/extensao/
