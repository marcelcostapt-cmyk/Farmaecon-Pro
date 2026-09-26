# ADR — Contexto de empresa e papel PostgreSQL restrito

Data: 21/09/2026. Status: implementado; exigir CI desta revisão antes de produção.

## Problema e alternativas

Filtros `tenantId` na API não protegem uma consulta esquecida ou uma relação
criada com conta de outra empresa. Usar o proprietário do schema também ignora
RLS. Consideramos manter só filtros da aplicação, criar banco por empresa ou
usar políticas PostgreSQL com contexto definido pelo servidor.

## Decisão

- Oito tabelas de domínio têm RLS, negação padrão sem contexto e `WITH CHECK`
  para novas linhas. Relações pedido/conta, transação/pedido e estado/sessão
  também precisam pertencer à mesma empresa.
- `farmaecon_runtime` não é proprietário, superusuário nem BYPASSRLS; não recebe
  TRUNCATE ou DDL. O administrador de migrações/backup é outra identidade e suas
  credenciais não são injetadas na API.
- Guards verificam o principal antes do interceptor. O contexto vem desse
  principal e dos jobs previamente autorizados; nunca de corpo/query/header
  arbitrário. AsyncLocalStorage separa execuções concorrentes.
- Cada consulta usa uma transação com `set_config(..., true)` na mesma conexão.
  Transações explícitas usam callback e o mesmo cliente; não se usa transação
  em lote com promises previamente iniciadas. Nenhuma variável persiste no pool.
- Autenticação antes de conhecer a empresa usa uma única função de lookup por
  email exato, SECURITY DEFINER com search_path fixo, sem execução por PUBLIC.
  A função devolve o hash apenas ao backend; não existe endpoint dessa função.
  Bootstrap, migração, backup e limpeza administrativa usam a identidade de
  manutenção fora do processo web/API.
- States OAuth são consumidos em transação curta e confirmada antes de acessar
  o provedor. Replay de refresh confirma a revogação antes de responder 401.

## Consequências e limites

Consultas adicionais e transações aumentam o custo por operação. Monitorar
latência/pool e só agrupar transações sem manter locks durante chamadas externas.
RLS é defesa contra falhas de consulta; não substitui validação de JWT, RBAC ou
proteção das credenciais do servidor. Migrações precisam de permissão para
criar o papel restrito. Uma restauração precisa recriar o papel e reaplicar
grants antes de iniciar a API; nunca reutilizar a senha do administrador.

## Verificação

`test:postgres-security` executa consultas sem filtro, ausência de contexto,
escritas cruzadas, referência a conta estrangeira, negação de DDL/TRUNCATE e
10 transações concorrentes, além do fluxo HTTP e OAuth com fixture. Os testes
de navegador e backup/restore usam o mesmo papel restrito na aplicação.

Fontes: [PostgreSQL 15 — Row Security](https://www.postgresql.org/docs/15/ddl-rowsecurity.html),
Prisma 7.7 instalado (transações interativas).
