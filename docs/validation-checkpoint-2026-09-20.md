# Checkpoint de validação — 20/09/2026

Repositório: `marcelcostapt-cmyk/Farmaecon-Pro`.
Base: `3cd93c7f2b6c28e9525c8a8aeb014efecde827cd`.
Branch de trabalho: `codex/production-observation-deploy`.

## Evidência anterior, confirmada no GitHub

O [CI da base](https://github.com/marcelcostapt-cmyk/Farmaecon-Pro/actions/runs/35441629864)
terminou com sucesso: testes da API, tipos, builds, Docker, migrações e fluxo de
observação com duas empresas. Isso valida a base anterior; não valida as
alterações de produção deste checkpoint.

## Executado nesta revisão

- `npm ci --ignore-scripts --no-audit --no-fund`: concluído.
- `npm exec --workspace api -- prisma generate`: concluído, Prisma 7.7.0.
- `npm test --workspace api -- --runInBand --no-cache`: 29 testes, 4 suítes, todos passaram.
- `npm run typecheck`: API e web passaram.
- `npm run build`: API e web passaram após adicionar `packageManager` na raiz.
- `node --test scripts/production.test.mjs`: 5 testes passaram, incluindo
  geração/preservação de segredos, preflight e backup cifrado com detecção de adulteração.
- `scripts/verify-production-compose.mjs`: produção e complemento VPS resolvidos
  pelo Docker Compose 2.39.4; testes de variáveis obrigatórias, rede privada,
  migração, imagens e URL interna passaram. Esse teste não inicia containers.
- Sintaxe dos scripts novos e `git diff --check`: passaram.

## Validação Docker e publicação da branch

- Branch publicada: `codex/production-observation-deploy`.
- [Pull Request #1](https://github.com/marcelcostapt-cmyk/Farmaecon-Pro/pull/1)
  aberto após autorização explícita do responsável. O erro inicial de permissão
  HTTP 403 foi superado e o envio foi confirmado pela API do GitHub.
- O CI do PR executa `npm run test:production-stack`: inicialização com
  configuração de produção, bootstrap de administrador, login, persistência após
  reinício, backup cifrado e restore isolado. O runtime local desta sessão não
  disponibiliza daemon Docker; a execução de containers é feita nos runners do
  GitHub Actions.
- A lista de [execuções da branch](https://github.com/marcelcostapt-cmyk/Farmaecon-Pro/actions?query=branch%3Acodex%2Fproduction-observation-deploy)
  e os checks do PR registram o resultado de cada commit. Exigir CI aprovado na
  versão escolhida antes de publicar imagens ou promover uma release.
- VPS, DNS, HTTPS, imagens publicadas e OAuth real não foram alterados nem
  verificados novamente por falta de acesso Hostinger nesta sessão.

## Bloqueios antes de conta real

- Revogar/substituir o segredo Mercado Livre presente anteriormente no arquivo
  de exemplo público. A remoção desta versão não revoga nem apaga o histórico.
- Exigir aprovação do cenário completo de containers no CI da versão a publicar.
- Completar separação do usuário de banco/RLS; os testes atuais provam filtros
  de autorização da API, não isolamento imposto pelo PostgreSQL.
- Tratar cobertura de pedidos e dados financeiros ausentes no conector antes
  de certificar os relatórios com informações reais.
- Revalidar infraestrutura e executar publicação, backup off-host, HTTPS e
  consentimento OAuth conforme `production-observation.md`.
