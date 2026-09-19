# Guia de Onboarding e Importação de Contas (Farmaecon PRO)

Bem-vindo ao Farmaecon PRO! Este guia rápido visa instruir novos lojistas sobre como registrar seu negócio (Tenant) e integrar suas contas de Marketplace.

## 1. Cadastro Inicial do Lojista (Tenant)
1. Acesse o portal `app.farmaeconpro.com` e clique em **Criar Conta**.
2. Forneça o CNPJ/CPF e nome da empresa.
3. Isso criará o seu "Tenant" seguro. Você se tornará o usuário `ADMIN` desta área de trabalho.
4. (Opcional) Convide seus gestores e operadores de estoque acessando `Configurações > Equipe`.

## 2. Importação de Contas de Marketplace (Integrações)

O Farmaecon PRO atua em "Modo Multi-Conta". Você pode adicionar quantas contas quiser do Mercado Livre ou outros parceiros sem conflito de informações.

### Vinculando Mercado Livre
1. Vá até o menu lateral e clique em **Integrações**.
2. No card do **Mercado Livre**, clique em "Adicionar Conta".
3. Você será redirecionado para o portal de login do Mercado Livre (`auth.mercadolivre.com.br`).
4. Autorize o aplicativo do Farmaecon PRO a gerenciar vendas, mensagens e produtos.
5. Após o redirecionamento, a conta aparecerá na lista como *Ativa*.
6. Dê um nome interno para a conta (ex: "ML - Farma Oficial") para se guiar nos filtros do Dashboard.

### Processo de Sincronização Inicial
Assim que a conta é vinculada, nosso sistema de *Background Workers* inicia automaticamente as seguintes tarefas na fila (BullMQ):
- **Importação de Anúncios:** Todos os itens ativos e pausados são baixados. Seus SKUs serão mapeados para o seu Catálogo.
- **Importação de Vendas Recentes:** Baixa os últimos 30 dias de vendas para popular o seu dashboard inicial e a sua DRE.

> **Importante:** A primeira carga pode demorar de 5 a 15 minutos dependendo do seu volume de vendas.

## 3. Gestão de Tokens (Tokens de Acesso)
As credenciais de segurança do Mercado Livre expiram a cada 6 horas.
A arquitetura do Farmaecon PRO (por segurança) gerencia a renovação de *Refresh Tokens* automaticamente nos bastidores.
- Caso ocorra algum descompasso ou revogação de senha no ML, nosso sistema disparará um alerta no Dashboard (e por e-mail) solicitando que você clique em "Renovar Token".

## 4. Cadastro Inicial de Custos
A importação de anúncios **não puxa custos de fornecedores**, pois essa informação não existe nos marketplaces.
Após a primeira sincronização, acesse `Produtos > Custos` e faça o upload de uma planilha CSV com:
`SKU | Custo Produto | Custo Embalagem | Imposto (%)`

Isso garantirá que a sua DRE calcule instantaneamente o *Lucro Real* das suas vendas.
