# Checkpoint 16 — API/health, Escritório Virtual e imagem rastreável

Data: 2026-09-27
Branch: `codex/production-observation-deploy`
Modo: `MARKETPLACE_MODE=OBSERVATION`
Fonte de validação: `MOCK`

## Entregue

- Corrigidos os caminhos dos componentes do Escritório Virtual para o alias real do Web (`@/* -> apps/web/src/*`).
- Criada a rota autenticada `/escritorio` em `apps/web/src/app/(dashboard)/escritorio/page.tsx`.
- Criados os componentes `StatusBadge`, `AgentStatusList` e `OfficeScene` em `apps/web/src/components/escritorio/`.
- Adicionado teste do controlador de health/readiness, cobrindo liveness, readiness saudável e dependência indisponível.
- Mantida a separação entre dados observacionais/simulados e ações externas; nenhuma escrita em marketplace foi habilitada.

## Evidência local/CI

Workflow final: [run 36350333387](https://github.com/marcelcostapt-cmyk/Farmaecon-Pro/actions/runs/36350333387)

O job `verify` terminou com sucesso e executou:

- testes de segurança e credenciais;
- testes da API;
- typecheck;
- build raiz/Web/API;
- builds Docker de API e Web;
- Compose local com PostgreSQL e Redis;
- seed e smoke test;
- testes PostgreSQL/RLS e upgrade de migração;
- teste de navegador;
- stack de produção local;
- preservação do pacote das imagens validadas.

Commit do código: `5e4cbaf8c3a533b92af0b13449d00a8a25913725`.
Commit do checkpoint: `e8cf6356717619aa342d06ba096c2e18c6023f4f`.

## Imagem Web rastreável

O pipeline preserva as imagens validadas com tag derivada do SHA do commit. A regra foi introduzida no workflow pelo commit `bfea043c8a7d240c8ab6504391bf3673257c7bb8`.

Artefato final: `farmaecon-images-473f47a6a0a6c97852beddc3f581a9338447f051`

- Artifact ID: `10942590125`
- Digest do arquivo: `sha256:ba403c15f6fbad8ec2d755061ab1f8ad19ee909d39cf3d6e42a1a89555271542`
- Retenção do artefato: até 2026-10-04
- Run: [36350333387](https://github.com/marcelcostapt-cmyk/Farmaecon-Pro/actions/runs/36350333387)

As tags internas esperadas no pacote final são `farmaecon-api:e8cf63567176` e `farmaecon-web:e8cf63567176`.

## Bloqueio remoto

Não foi possível, nesta sessão, usar Hostinger Connector ou SSH. Portanto, a recuperação da API na VPS e a validação remota de health/readiness, login, HTTPS e relatório permanecem pendentes. Não declarar deploy remoto concluído com base apenas no CI.

Após obter acesso à VPS, o próximo passo seguro é:

1. salvar o estado atual e verificar o backup;
2. carregar o artefato e conferir `SHA256SUMS`;
3. atualizar apenas as referências `API_IMAGE` e `WEB_IMAGE` no arquivo de ambiente protegido;
4. executar migração compatível e atualizar API/Web sem recriar Traefik, PostgreSQL ou Redis;
5. verificar `/api/v1/health`, `/api/v1/ready`, login inválido (401), redirecionamento protegido de `/escritorio`, HTTPS e relatório observacional;
6. manter rollback para as imagens anteriores se qualquer verificação falhar.

Nenhuma credencial, token de marketplace ou segredo foi incluído neste checkpoint.
