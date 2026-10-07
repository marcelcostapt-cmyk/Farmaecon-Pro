# Checkpoint 06 — Artefato de imagens verificado

Data: 26/09/2026. Status: **ARTIFACT_VERIFIED**.

## Evidência

O artefato de imagens validado pelo CI foi localizado no GitHub Actions:

- Nome: `farmaecon-images-58dede46fd98d727e66e15947e321e2e7314a9ad`
- Workflow run: `35550782370`
- Artifact ID: `10617529383`
- Commit das imagens: `ea5939d5befac1f4c38aba4117b0d29cf26f0bff`
- SHA-256 do ZIP: `a6a4627520b197664ddabffbc398d3d162c6baf5a06fcb922933698255ec3b48`
- Expiração do artefato: 28/09/2026 01:28 UTC
- API: `sha256:07d34f43fd093996e66b261b8eedc6791fdcc4be35eb352cdbe75758038a6d99`
- Web: `sha256:bc11a8fcf90239508dcc4ad5f9048f72aea056f88c7d6d311ac3119dff8aeff8`

O checksum foi confirmado localmente pelo operador.

## Estado da publicação

- O arquivo ainda não foi carregado na VPS.
- Nenhum container Farmaecon foi iniciado.
- Traefik e DNS permanecem sem alterações.
- Nenhum segredo, token ou credencial foi registrado.
- O modo continua `MARKETPLACE_MODE=OBSERVATION`.

## Próximo gate

Transferir o artefato para `/opt/farmaecon` pelo acesso autorizado, conferir o SHA-256 no host, executar `docker load`, comparar os dois digests das imagens e só depois validar o Compose, a migração e os healthchecks.
