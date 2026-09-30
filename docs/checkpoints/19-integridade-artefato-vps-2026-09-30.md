# Checkpoint 19 — Integridade do artefato de imagens na VPS

Data: 2026-09-30
VPS: `srv1975247`
Modo esperado: `MARKETPLACE_MODE=OBSERVATION`
Fonte: `MOCK`

## Estado confirmado na VPS

- `farmaecon-api-1`: `farmaecon-api:58dede46`, saudável.
- `farmaecon-web-1`: `farmaecon-web:47b57137-escritorio`, saudável.
- PostgreSQL, Redis e Traefik: ativos/saudáveis.
- Redes: `proxy` e `farmaecon_farmaecon-internal`.
- Volumes: `farmaecon_pgdata` e `farmaecon_redisdata`.
- Espaço livre: aproximadamente 90 GB.
- Imagens atuais têm digests locais, sem RepoDigest de registry.

## Bloqueio de publicação

O arquivo `/opt/farmaecon/images.tar.gz` existe, mas:

```
sha256sum -c /opt/farmaecon/SHA256SUMS
images.tar.gz: FAILED
```

O pacote não pode ser carregado nem usado para atualizar API/Web. Os containers atuais foram preservados e não foram reiniciados.

## Configuração observada

- `MARKETPLACE_SOURCE=MOCK` está presente em `.local/production.env`.
- `MARKETPLACE_MODE` não apareceu nessa filtragem do arquivo; o endpoint público continua retornando modo `OBSERVATION`, mas a variável deve ser confirmada antes da publicação.

## Próximo passo seguro

Obter uma cópia íntegra do artefato CI, validar `SHA256SUMS` novamente e só então solicitar confirmação específica para atualizar API/Web. Traefik, PostgreSQL, Redis, redes e volumes devem permanecer intocados. Nenhuma credencial ou segredo foi incluído neste checkpoint.