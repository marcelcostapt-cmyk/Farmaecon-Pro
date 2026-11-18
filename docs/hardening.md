# Hardening de infra — Farmaecon Pro

_2026-11-18 · branch `feature/infra-hardening`_

Reduzir o risco de produção antes de abrir a utilizadores reais. **Nada aqui faz
deploy, mata processos ou toca em dados/ML.** Os passos que mexem no host de
produção (swap, firewall, migração de `production.env` para digest) exigem
confirmação e correm na VPS, não neste repositório.

## O que já foi feito no repositório (validável por CI)

### 1. Imagens fixadas por digest (não por tag)
`scripts/production-env.mjs` passou a **exigir** que `API_IMAGE`/`WEB_IMAGE`
sejam um digest `nome@sha256:<64 hex>`. Uma tag é mutável (pode ser republicada
sobre o mesmo nome); o digest garante que corre exatamente o que o CI testou.

- Testes: `node --test scripts/production.test.mjs` (rejeita tag, aceita digest).
- Consequência: o próximo `npm run prod:check` na VPS **falha** enquanto o
  `production.env` usar tags. Converter assim (na VPS, sem deploy):

  ```bash
  # digest local de uma imagem já construída
  docker image inspect farmaecon-api:<tag-atual> \
    --format '{{index .RepoDigests 0}}'   # -> nome@sha256:...
  # editar .local/production.env: API_IMAGE=<nome>@sha256:...  (idem WEB_IMAGE)
  npm run prod:check                      # tem de dar PASS
  ```

  As imagens em execução a 2026-11-14 eram
  `farmaecon-api` `sha256:1ef8393fc870b77dbde0cb222741577abbc0d11a63d2758c257b401c5f561468`
  e `farmaecon-web` `sha256:0cb5f711498fd4ec80a264b1c98b955f0c8ed27215fc21035a60d731fd3ba49e`
  (confirmar com `docker image inspect` antes de usar).

### 2. Imagem da API produção-only
`apps/api/Dockerfile` passou a podar devDeps no fim do build
(`npm prune --omit=dev`), removendo typescript, jest, eslint, nest cli, ts-node…
do runtime. O `prisma` (CLI) foi movido de `devDependencies` para
`dependencies` em `apps/api/package.json` porque o serviço `migrate` corre
`prisma migrate deploy` em runtime — o prune mantém-no, bem como o cliente
gerado.

> **Validação:** só o CI confirma (build das imagens + `docker compose up --wait`
> + migrate + smoke). **Não construir a imagem na VPS** (carga pesada). Não fazer
> merge nem deploy desta mudança até o CI estar verde.

## Passos no host (confirmar antes de correr)

### 3. Swap (3 GB)
A VPS de produção está **sem swap** (`free -m` → Swap 0; 7,9 GB RAM). Script
idempotente e reversível:

```bash
sudo bash scripts/hardening/setup-swap.sh
```

### 4. Firewall (UFW)
UFW **inativo**. O script define as regras (22/80/443) mas **não ativa** sem
`--enable`, para evitar lockout do SSH:

```bash
sudo bash scripts/hardening/ufw-setup.sh        # só define as regras
# confirmar que a 22/tcp está permitida e que há acesso SSH, depois:
sudo ufw enable
```

### 5. Teste de restauro de BD end-to-end
Mecanismo já existe (`scripts/production-backup.mjs`). Corre na VPS, a partir de
`/opt/farmaecon`, com a `BACKUP_ENCRYPTION_KEY` de produção. Usa um container
Postgres descartável (`--network none`, tmpfs) — **a BD de produção não é
tocada**:

```bash
cd /opt/farmaecon
npm run prod:backup                         # pg_dump cifrado (leitura)
npm run prod:verify-restore .local/backups/<ficheiro>.pgdump.enc
# espera: "PASS: authenticated archive restored ... Production database untouched."
```

## Fora do âmbito (não feito)
- Triagem de vulnerabilidades npm (`npm audit`) — passo próprio.
- Alinhar `main` com a branch de integração.
- Certificação do app ML (pré-requisito para escrita comercial, não para leitura).
