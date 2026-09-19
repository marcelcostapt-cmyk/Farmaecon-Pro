# Backlog e Roadmap de Funcionalidades: Farmaecon PRO

Este documento detalha as histórias de usuário (User Stories), divididas em Épicos, para o desenvolvimento da plataforma. Também apresenta o roadmap macro do projeto.

## Épicos e Histórias de Usuário (Backlog)

### Épico 1: Fundação Multi-Tenant e Autenticação
- **US 1.1:** Como Administrador, quero criar uma conta (Tenant) para minha empresa no SaaS para começar a gerenciar meu negócio.
- **US 1.2:** Como Administrador, quero convidar usuários para o meu Tenant, definindo regras de acesso (Gestor, Operador) para controlar o que podem visualizar.
- **US 1.3:** Como Usuário, quero fazer login seguro e recuperar minha senha para acessar o painel de controle.

### Épico 2: Gestão de Contas de Marketplaces (Integrações)
- **US 2.1:** Como Gestor, quero vincular uma conta do Mercado Livre autorizando o aplicativo via OAuth, para iniciar a sincronização.
- **US 2.2:** Como Gestor, quero vincular múltiplas contas (ex: 3 contas do ML, 1 da Amazon) sob o mesmo Tenant, para centralizar a gestão.
- **US 2.3:** Como Sistema, devo renovar os *refresh tokens* automaticamente antes da expiração para evitar queda na integração.

### Épico 3: Catálogo, Anúncios e Custeio de Produtos
- **US 3.1:** Como Operador, quero visualizar a lista unificada de todos os meus anúncios ativos por canal de venda.
- **US 3.2:** Como Gestor, quero registrar os custos dos produtos (fornecedor, impostos, taxas fixas de frete/embalagem) por SKU para calcular a rentabilidade real.
- **US 3.3:** Como Operador, quero ter a funcionalidade de duplicar/clonar um anúncio de forma facilitada para testar novas estratégias de preço e título.

### Épico 4: Gestão de Vendas, Estoque e Logística (Shipment Center)
- **US 4.1:** Como Gestor, quero visualizar todas as vendas recebidas nos diversos marketplaces num painel único com status atualizado.
- **US 4.2:** Como Operador, quero sincronizar estoques automaticamente, de forma que a venda num anúncio do ML debite o estoque num anúncio espelho da Amazon ou do mesmo ML.
- **US 4.3:** Como Operador de Expedição, quero um painel de Envios ("Shipment Center") para gerar etiquetas, faturar notas fiscais e controlar envios para o Full/FBA.

### Épico 5: Inteligência Financeira (DRE e Dashboards)
- **US 5.1:** Como Gestor, quero um Dashboard Master com KPIs em tempo real: faturamento total, ticket médio e lucro bruto por dia/mês.
- **US 5.2:** Como Gestor, quero visualizar uma DRE (Demonstração do Resultado do Exercício) detalhada com receitas, taxas de comissão, custos de frete, impostos e lucro líquido.
- **US 5.3:** Como Administrador, quero fazer lançamentos de despesas operacionais manuais (recorrentes ou não) para integrar ao resultado da DRE.

### Épico 6: Automação e Mensageria
- **US 6.1:** Como Operador, quero configurar regras de envio de mensagens automáticas pós-venda para clientes no Mercado Livre.
- **US 6.2:** Como Sistema, devo gerar alertas automáticos via painel (e e-mail) quando o estoque de produtos curva A atingir um limite crítico.

---

## Roadmap de Lançamento

A implementação será dividida em fases (Milestones) para garantir entregas incrementais de valor:

### Fase 1: MVP Estrutural (Mês 1)
- Scaffold do projeto (NestJS + Next.js).
- Infraestrutura base (DB, Redis, Docker).
- Autenticação e Multi-tenant.
- Fluxo de OAuth Fake/Sandbox (preparação para APIs reais).
- Catálogo básico e Cadastro de Custos de SKUs.

### Fase 2: Integração Core de Marketplaces (Mês 2)
- Integração oficial Mercado Livre (OAuth real).
- Sincronização em *background* de Anúncios e Vendas.
- Tabela consolidada de pedidos.

### Fase 3: Módulo Financeiro e Inteligência (Mês 3)
- Dashboard Principal e Gráficos de Receita x Custos.
- DRE dinâmica com base nas vendas sincronizadas.
- Central de Custos e Despesas Manuais.

### Fase 4: Automação e Logística (Mês 4)
- Sincronização bidirecional de estoque (Stock Sync).
- Duplicador de anúncios e edição em massa.
- Shipment Center (impressão de etiquetas, separação).
- Mensageria automática pós-venda.

### Fase 5 (Futura): Inteligência Artificial e Expansão
- **Repricing Dinâmico com IA:** Ajuste de preço automatizado com base na concorrência, visando ganhar a Buy Box garantindo a margem mínima.
- **Previsão de Demanda (Sazonalidade):** Machine learning para sugerir quantidade de compras do fornecedor baseando-se no histórico de vendas e tendências (Joom Pulse).
- **Análise de Sentimento:** IA classificando reviews de clientes e sugerindo melhorias de produtos.
- **Integração Adicional:** Shopee, Amazon, Magalu e TikTok Shop.
