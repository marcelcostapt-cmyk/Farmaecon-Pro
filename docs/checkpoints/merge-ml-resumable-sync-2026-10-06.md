# Checkpoint — merge local da sincronização resumível

Data: 2026-10-06 (UTC). Validações locais executadas em 2026-10-05/06.

## Escopo e referências

- Branch de trabalho: `feature/merge-ml-resumable-sync`.
- Base de produção: `origin/codex/production-observation-deploy`, commit `17d504634f007f3b491460fdfe560f18ae304366`.
- Feature integrada: `origin/feature/ml-resumable-sync`, commit `e2f6f639b7449e66194a25133a46cad98fc49aaf`.
- Merge preparado em um worktree separado, `farmaecon-merge`, após `git fetch --all`.
- A pasta original `farmaecon-pro` permanece na sua branch e com suas alterações locais. Os 14 arquivos preservados no backup `20261005T100842Z-pre-merge` foram novamente comparados por SHA-256: nenhum mudou.
- Nenhuma branch original foi movida. Nenhum push, PR, acesso à VPS, migration em banco real ou chamada ao Mercado Livre foi executado nesta etapa.

## Resolução dos conflitos

Os 11 conflitos foram resolvidos nos seguintes arquivos:

| Arquivo | Resultado |
| --- | --- |
| `.github/workflows/ci.yml` | Combina as verificações de produção com testes da feature, execução das suítes dentro de imagens e publicação dos artefatos do CI. |
| `apps/api/prisma/schema.prisma` | Preserva campos legados, inclusive `lastSyncState` obrigatório e seu default, e adiciona estado, janelas e chave única por empresa/conta/pedido. |
| `apps/api/src/modules/integrations/integrations.service.ts` | Mantém seleção pública sem tokens e acrescenta progresso persistido por conta. |
| `apps/api/src/modules/integrations/ml-api.service.ts` | Mantém o método legado para compatibilidade, os métodos de paginação novos e os filtros por `date_closed`. Preserva renovação de token somente para HTTP 401, não para 403. |
| `apps/api/src/modules/integrations/ml-orders-sync.service.ts` | Combina persistência por página/janela com validação de produção antes de qualquer upsert da página. |
| `apps/api/src/modules/observation/observation.service.ts` | Mantém soma em centavos, alertas de dados antigos/falhos e indisponibilidade financeira, adicionando progresso por conta. |
| `apps/web/src/app/(dashboard)/escritorio/page.tsx` | Preserva a página de produção, com identificação de simulação. |
| `apps/web/src/app/(dashboard)/observation/page.tsx` | Combina cobertura e atualização com limites explícitos dos dados e alerta de falha. |
| `apps/web/src/components/escritorio/AgentStatusList.tsx` | Preserva os seis agentes de produção e aceita a interface opcional de agentes da feature. |
| `apps/web/src/components/escritorio/OfficeScene.tsx` | Preserva a cena e os avisos de simulação de produção. |
| `apps/web/src/components/escritorio/StatusBadge.tsx` | Aceita os estados de ambas as branches e mantém acessibilidade. |

O código de autenticação, `security.spec.ts`, o interceptor/contexto de tenant e os processadores de fila de produção foram comparados com a base e continuam intactos.

## Compatibilidade de segurança e dados

- O processamento retomável continua usando janela UTC de hora cheia, primeira janela de 90 dias e sobreposição de 2 horas. Uma execução interrompida mantém a janela e o cursor. O guard `PAGINATION_TOTAL_CHANGED` permanece ativo.
- A página inteira passa pelas validações de produção de identificador, BRL, valor, precisão monetária e data antes dos upserts. Os testes incluem uma linha válida seguida de outra inválida e exigem zero upserts e cursor inalterado.
- A nova tabela usa o mesmo `AsyncLocalStorage`/`PrismaService.withTenant` da produção. O contexto é aplicado na conexão da transação com `SELECT set_config('app.tenant_id', tenantId, true)`; os workers continuam usando `inTenant`.
- A migration local previamente preparada `20261004_marketplace_sync_state_rls` foi incorporada sem alterações. Ela habilita RLS, recria `tenant_isolation` com `DROP POLICY IF EXISTS`, valida a conta da mesma empresa no `WITH CHECK` e concede somente `SELECT, INSERT, UPDATE`.
- A inicialização da API exige RLS nas nove tabelas. Portanto, esta API não deve ser implantada sobre um banco que ainda não recebeu as migrations pendentes.
- As continuações usam os identificadores automáticos do BullMQ. O identificador anterior continha separadores incompatíveis e poderia ser reutilizado entre ciclos, suprimindo continuações enquanto jobs antigos permanecessem retidos. O cursor e a idempotência continuam no banco.
- A interface distingue pedidos armazenados no histórico de pedidos esperados na janela, sem formar uma razão entre contagens de escopos diferentes. `COMPLETE` não certifica todo o histórico nem a cobertura do período escolhido no relatório.
- A correção dos redirecionamentos públicos da feature foi preservada. Valores recebidos em `error` no callback OAuth não são gravados em logs.

## Migrations preservadas

Todos os seis arquivos SQL existentes nas duas branches foram comparados byte a byte com sua branch de origem e permanecem intactos.

| Migration | SHA-256 |
| --- | --- |
| `20260921_sync_evidence` | `4e3d8f09db790645f4516b9c0d77df36f57ae118c6221f6abf4b6b93fd6d3ddf` |
| `20260921_tenant_rls` | `69e89398329d7e2b15f445b856c16e003c16f39d8b93230cb34e3fb9499eeb60` |
| `20261003_resumable_marketplace_sync` | `615cab5e04ad06068ba0be58045893d1a5d3face999e549f94715d925daf213a` |
| `20261003_resumable_marketplace_sync_window` | `523f61b661ed124b36b36cb4f3f1fa38904b631fa04fc89356abbc70f8e4db4e` |
| `20261004_marketplace_sync_state_rls` — nova no merge | `90878ef0073879a02367ef9c3d61a51a4295ec4d743dcee98a2449a031ba1398` |

Nenhum desses arquivos foi aplicado a um PostgreSQL nesta etapa. A repetição de `prisma migrate deploy` deve respeitar o histórico; isto não equivale a executar repetidamente o SQL bruto de todas as migrations antigas.

## Verificações locais executadas

Ambiente: Node 24.19.0 e npm 11.9.0. O workflow usa Node 22, com validação ainda pendente no runner.

| Comando/verificação | Resultado observado |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=30000` | Concluído. A primeira tentativa offline não tinha todos os pacotes em cache; a instalação seguinte funcionou. |
| `npm exec --workspace api -- prisma generate` | Concluído, Prisma 7.7.0. |
| `npm exec --workspace api -- prisma validate` | Schema válido. Sem conexão a banco. |
| `npm test --workspace api -- --runInBand` | **11 suítes, 96 testes aprovados**, nenhum teste pulado. Inclui os testes herdados de segurança, validação, retomada, janelas e os testes unitários do contexto/RLS. |
| `npm run test:web --workspace web -- --runInBand` | **1 suíte, 5 testes aprovados**. A pasta gerada `.next` é excluída da descoberta de módulos do Jest. |
| `npm run typecheck` | Aprovado para API e Web. |
| `npm run build --workspace api` | Aprovado. |
| `npm run build --workspace web` | Aprovado. Confirmado `apps/web/.next/standalone/apps/web/server.js`. |
| `node --test scripts/production.test.mjs` | **5 testes aprovados**, incluindo criptografia/restauração do arquivo sintético de backup. Isto não é um restore PostgreSQL. |
| `python3 -m unittest scripts/test_marketplace_credentials.py` | **4 testes aprovados**, com dados de teste. |
| `npm run security:scan` | Nenhum padrão de credencial suportado ou segredo preenchido em template detectado nos arquivos candidatos. O scanner não certifica histórico Git, backups ou segredos da VPS. |
| Parse de `.github/workflows/ci.yml` e `node --check scripts/production-ci.mjs` | Sintaxe válida. Isto não executa o workflow. |
| `git diff --check` e busca de marcadores de conflito | Sem problemas nos arquivos resolvidos. |

Os testes unitários da API foram executados com `DATABASE_URL`/`DIRECT_URL` removidos do ambiente, `FARMAECON_ENV_FILE=.missing-test-env`, `MARKETPLACE_SOURCE=MOCK` e `MARKETPLACE_MODE=OBSERVATION`. Os logs locais estão em `.local/merge-verification/` e não são versionados.

## CI preparado e verificações ainda NÃO executadas

Docker, PostgreSQL e Redis não estão disponíveis neste workspace. Nenhum resultado local acima substitui o runner real.

- Build das imagens API/Web, suítes em containers, smoke test Docker e navegador Chromium contra a stack: **pendentes**.
- PostgreSQL real: migração de banco vazio, upgrade com dados, repetição do deploy, RLS das nove tabelas, ausência de contexto e rejeição de conta de outra empresa: **pendentes**.
- O teste PostgreSQL da feature foi adaptado para autenticar como `farmaecon_runtime`. A conexão de proprietário serve somente às fixtures no banco isolado. Foi acrescentado teste com fila Redis exclusiva e duas passagens para confirmar que a segunda continuação não é descartada e os 51 pedidos sintéticos não são duplicados: **ainda não executado**.
- O teste de upgrade agora compara a lista completa de migrations, em vez de fixar quatro. A verificação de restore aceita backups antigos com oito tabelas protegidas e exige nove quando a tabela nova existir.
- O teste de stack usa o endereço loopback efetivo em `FRONTEND_URL`, acompanhando o novo redirecionamento público. Isso só modifica a configuração descartável do teste.
- O workflow preserva testes e backup/restore isolado da produção e acrescenta os testes PostgreSQL da feature. Só depois de todos os gates gera `images.tar.gz`, `IMAGE_IDS`, `SHA256SUMS` e a cópia de compatibilidade `images.ids`.
- GitHub Actions **não foi disparado**; nenhum artefato Docker novo foi gerado, validado ou promovido por esta execução.

## Próximo gate

Publicar a nova branch para executar e acompanhar o CI com Docker. Somente após CI verde e conferência dos artefatos deve ser retomada, com o escopo autorizado pelo usuário, a validação isolada e depois a Fase C. Este checkpoint não declara produção pronta nem restauração/RLS real concluídos.

```text
CHECKPOINT=MERGE_ML_RESUMABLE_SYNC_LOCAL
WORK_BRANCH=feature/merge-ml-resumable-sync
LOCAL_API_SUITES=11/11
LOCAL_API_TESTS=96/96
LOCAL_WEB_TESTS=5/5
TYPECHECK=PASS
API_BUILD=PASS
WEB_BUILD=PASS
REAL_DOCKER_CI=NOT_RUN
REAL_POSTGRES_RLS=NOT_RUN
REMOTE_PUSH=NO
PRODUCTION_CHANGED=NO
PRODUCTION_MIGRATION_APPLIED=NO
REAL_MARKETPLACE_CALLS=0
NEXT_GATE=REMOTE_CI_WITH_DOCKER
```
