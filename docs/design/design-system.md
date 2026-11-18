# Farmaecon — Sistema visual interno (bloqueado 2026-11-14)

Derivado da cena de escritório escolhida **C · Palco da equipa**, variação **C2 · Estações no balcão**, e da direção visual da secção 3 do brief. Tokens em [`tokens.css`](./tokens.css). É um sistema de design (documentação), não código de produção.

## 1. Princípios
- **Clareza profissional para tabelas financeiras diárias.** Densidade útil, consistência entre páginas, gráficos/efeitos ao serviço da leitura.
- **Duas linguagens, um produto:** `/escritorio` (cena + agentes, inspiração WeStack) e os ecrãs de gestão (dashboards/tabelas, inspiração Jodda) partilham o **mesmo shell, marca e tokens**.
- **Transparência visível:** origem, qualidade e conciliação do dado são sempre distintas. Zero significa zero comprovado; em falta mostra-se "—"/"Pendente" com motivo, nunca um número inventado.
- **Observação:** indicador de Modo Observação sempre visível; sem comandos de escrita externa enquanto não houver fluxo de autorização.

## 2. Cor (papéis)
| Papel | Token | Uso |
|---|---|---|
| Navegação / títulos | `--fa-navy` | sidebar, h1/h2, mobília da cena |
| Ação principal / acento | `--fa-orange` (hover `--fa-orange-700`) | botão primário, item de menu ativo, destaque |
| Fundo da app | `--fa-bg` | base cinza |
| Superfície | `--fa-surface` | cards, header |
| Texto | `--fa-text` / `--fa-muted` / `--fa-muted-2` | corpo / secundário / vazio |
| Financeiro | `--fa-pos` (positivo), `--fa-neg` (prejuízo), `--fa-warn` (estimado/atenção) | **sempre com texto ou ícone**, nunca só cor |
| Qualidade do dado | `--fa-st-off/-wait/-idle` | estados "Não configurado / Aguardando dados / Sem execução" |
| Agentes | `--fa-ag-*` | acento por agente, diferenciado em matiz **e** luminosidade |

Regra: verde/vermelho/âmbar reservados a situações financeiras e alertas, acompanhados de texto/ícone. Preferir azul/laranja a vermelho/verde para distinções não-financeiras.

## 3. Tipografia
- Família: `--fa-font` (sans-serif legível já adotada).
- Escala: label 11 · corpo 14–16 · h2 22 · h1 28 · KPI 30.
- **Dinheiro:** `font-variant-numeric: tabular-nums`, alinhado à **direita**, formatação **pt-BR** (R$ 1.234,56), nunca truncar centavos. Markup ≠ margem — rotular sempre.

## 4. Espaço, raio, elevação
- Espaçamento em múltiplos de **8**; interior de card **16–24**.
- Raios: botão/chip `--fa-r-sm` (8) · input `--fa-r-md` (10) · card `--fa-r-lg` (13) · painel/cena `--fa-r-xl` (16) · pill `--fa-r-pill`.
- Sombras suaves `--fa-sh-1/2`. Sem gradientes decorativos fortes nem cards com borda-esquerda colorida.

## 5. Componentes (com estados)
- **Botão primário:** fundo `--fa-orange`, texto branco, `--fa-r-sm`; hover `--fa-orange-700`; `:disabled` opacidade .5; `:focus-visible` `--fa-focus`.
- **Botão secundário:** superfície branca, borda `--fa-border-2`, texto navy.
- **Chip (conta/período):** fundo `--fa-bg`, borda `--fa-border`, 12px/600. Chip **Modo Observação**: fundo `#FFF4EC`, borda laranja, ponto laranja.
- **Card:** superfície branca, borda `--fa-border`, raio `--fa-r-lg`, `--fa-sh-1`; título 13/800 navy.
- **Badge de estado (qualidade):** pill, par bg/fg dos tokens `--fa-st-*`, com ponto + **texto** (nunca só cor).
- **Item de nav:** 13/600; ativo = fundo `--fa-orange` + texto branco; hover = `#24374D`.
- **Estação de agente (C2):** monitor + figura sobre um balcão contínuo; placa com nome (14/800), função (muted), badge de estado e botão "Ver agente". Figura = SVG original Farmaecon (cabeça+corpo no acento do agente); **nomes e controlos em HTML**, nunca só dentro de imagem.
- **Estado vazio:** fundo `#F8FAFC`, borda tracejada, texto `--fa-muted-2`, com **motivo e próximo passo** ("Sem reuniões — ciclo de agentes não integrado").
- **Faixa de qualidade dos dados:** cobertura de custos · pendências · última sincronização; "Atualizar visualização" e "Sincronizar dados" são **ações distintas**.
- **Header de página:** título + descrição curta + chip de empresa/conta + chip de período + Modo Observação; contexto de conta/período preservado ao navegar.

## 6. Transparência (mapeia o brief §6)
Para cada valor, três dimensões independentes: **Origem** (API / arquivo / manual / cálculo) · **Qualidade** (Confirmado / Estimado / Pendente / Não aplicável) · **Conciliação** (Não conciliado / Conciliado / Divergente).
- Confirmado → valor + fonte + data + memória de cálculo.
- Estimado/projetado → rótulo explícito + premissas.
- Pendente → "Pendente"/"—" + motivo + próximo passo.
- Não aplicável → a regra que o justifica.
Nenhum indicador positivo esconde cobertura insuficiente.

## 7. Acessibilidade e movimento
- Alvos ≥ **44px**; foco visível (`--fa-focus`); navegação por teclado.
- Contraste texto ≥ 4.5:1 (labels 11px cinza passam; se 4.3:1 falhar, escolher tom que passe). Cores que se distinguem também diferem em luminosidade, não só matiz.
- Controlos reais (`<button>`, `<a href>`, `<label>`+`<input>`), mesmo em mockup; SVG decorativo `aria-hidden`, informativo `role="img"`+`aria-label`.
- **Movimento discreto** e respeita `prefers-reduced-motion`. Animação decorativa **não** comprova que um agente está a executar.
- Mobile: menu recolhível, tabelas com scroll localizado, mesmos detalhes/ações dos agentes.

## 8. Fronteira honesta
Este sistema descreve a **apresentação**. Os números financeiros vêm da camada determinística (DRE, por construir). A `/escritorio` real e os ecrãs de gestão dependem dos dados de itens de pedido, custos versionados e cálculos do DRE — ainda não implementados. Dados sintéticos só numa demonstração claramente identificada, separada das contas reais; nunca fixar no frontend os números do diagnóstico.
