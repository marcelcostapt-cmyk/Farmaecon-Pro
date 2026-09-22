# Checkpoint 2 — Containers, migrações e recuperação

Confirmado em 22/09/2026. **Concluído no ambiente isolado do GitHub Actions.**
Não executado na VPS ou no Mac do titular.

[CI aprovado](https://github.com/marcelcostapt-cmyk/Farmaecon-Pro/actions/runs/35550782370).
Fonte: `ea5939d5befac1f4c38aba4117b0d29cf26f0bff`.
Merge de teste: `58dede46fd98d727e66e15947e321e2e7314a9ad`.

- API, frontend, PostgreSQL e Redis iniciados juntos; health/readiness aprovados.
- Migrações em banco vazio concluídas. Base anterior preenchida com duas
  empresas atualizada duas vezes, preservando IDs, datas e valores, inclusive
  zero explícito; quatro migrações registradas.
- Configuração de produção usa banco/Redis sem portas públicas. A API usa
  identidade restrita; migração/bootstrap usam credencial distinta.
- Bootstrap de instalação vazia passou e a repetição recusou sobrescrever usuários.
- Login, relatório privado, renovação de cookies seguros e logout passaram no
  Chromium. O teste usa loopback; certificado público não foi testado.
- PostgreSQL e Redis reiniciados; dependências voltaram a ready e a sessão
  persistida continuou válida.
- Backup cifrado AES-GCM produzido, decifrado e restaurado em outro PostgreSQL
  sem rede. Migrações, tabelas e as oito tabelas com RLS foram verificadas.
- O procedimento usa apenas volumes descartáveis que o teste criou. Não removeu
  nem alterou volumes da VPS.

## Artefatos preservados para a publicação

[Artefato validado](https://github.com/marcelcostapt-cmyk/Farmaecon-Pro/actions/runs/35550782370/artifacts/10617529383)
`farmaecon-images-58dede46fd98d727e66e15947e321e2e7314a9ad`.

- ID: `10617529383`; 464.553.051 bytes.
- Expiração informada pelo GitHub: 28/09/2026, 01:28:53 UTC.
- SHA-256 do ZIP:
  `a6a4627520b197664ddabffbc398d3d162c6baf5a06fcb922933698255ec3b48`.
- Conteúdo: `images.tar.gz`, `images.ids` e `SHA256SUMS`, sem arquivos de ambiente.
- Imagem API: `sha256:07d34f43fd093996e66b261b8eedc6791fdcc4be35eb352cdbe75758038a6d99`.
- Imagem web: `sha256:bc11a8fcf90239508dcc4ad5f9048f72aea056f88c7d6d311ac3119dff8aeff8`.

Conferir hash do ZIP, depois `sha256sum -c SHA256SUMS`, carregar as imagens e
comparar os IDs no destino antes de promover. Usar essas imagens sem reconstrução.
Se expirarem, repetir a validação e registrar os novos IDs. O artefato não é um
backup de dados da empresa.

## Gate para a VPS

Seguir [o runbook de instalação](../production-observation.md), incluindo
inventário atualizado, Traefik, rede, espaço, volumes, chaves protegidas,
backup fora da VPS e teste de recuperação no ambiente de destino. Essa etapa
permanece bloqueada pela ausência das ferramentas Hostinger nesta sessão.
