# Contexto do Projeto — Farmaecon Pro

## Repositório
- Caminho local: /root/Farmaecon-Pro
- Remote: https://github.com/marcelcostapt-cmyk/Farmaecon-Pro.git
- Branch atual: feature/merge-ml-resumable-sync
- Sessão de trabalho: `tmux attach -t farmaecon`

## Ambiente de produção (VPS srv1975247)
- Pasta de deploy: /opt/farmaecon (não tem .git — só deploy/runtime)
- Containers: farmaecon-api-1, farmaecon-web-1, farmaecon-db-1, farmaecon-redis-1 (+ traefik-traefik-1)
- Compose: docker-compose.prod.yml + docker-compose.vps.yml, env em .local/production.env
- Recursos: 2 vCPU, 7,8 GB RAM, sem swap, sem GPU — não instalar ferramentas pesadas (ex.: Ollama) aqui.

### Comando de deploy/rollback da API (o `docker compose up` sem -f/--env-file FALHA)
```bash
/opt/farmaecon/scripts/checkpoint.sh
cd /opt/farmaecon && docker compose -p farmaecon -f docker-compose.prod.yml -f docker-compose.vps.yml \
  --env-file .local/production.env up -d --no-build api
/opt/farmaecon/scripts/checkpoint.sh
```
Nota: `up api` corre antes o serviço `migrate` (mesma imagem da API).

### Checkpoints
- Script: /opt/farmaecon/scripts/checkpoint.sh → acrescenta a /opt/farmaecon/deploy.log (imagens, nº de orders, containers).

## Estado atual — deploy do scheduler CONCLUÍDO (2026-11-14 19:30 UTC)
- API: farmaecon-api:e33588e-scheduler-20261114-164657
  (sha256:1ef8393fc870b77dbde0cb222741577abbc0d11a63d2758c257b401c5f561468; 1,97 GB em disco / 388 MB conteúdo)
  — deploy às 19:10 UTC, healthy, 0 restarts. Commit e33588e, sem migrations novas face a f69965b.
- Web: farmaecon-web:f69965b-20261114-153937 (sha256:0cb5f711498fd4ec80a264b1c98b955f0c8ed27215fc21035a60d731fd3ba49e) — inalterada.
- Scheduler: 5 contas Mercado Livre (tenant eb5f0f20…) com BullMQ job scheduler `orders-sync-<accountId>`, a cada 15 min:
  893285ca, 930788df, 2dd33686, 3fb4ba8a, b018bd8f.
  - Registados via sync manual (job `sync-account-orders`) às 19:13–19:15 UTC.
  - Primeiros ticks automáticos 19:28–19:30 UTC: todos SYNCED, 0 jobs falhados, sem erros nos logs.
  - Próximos ticks ~19:43–19:45 UTC (depois a cada 15 min).
  - O schedule só é criado quando um sync de conta completa (não no arranque da API).
- Orders: baseline 10.119 → 10.128 (+9 nos syncs manuais); ticks automáticos sem alteração (reimportam por upsert).
- Tokens ML: válidos 2–4h às 19:30 UTC; fila `token-refresh` com 11 refreshes agendados, 0 falhados.

### Backup / rollback do deploy do scheduler
- Pasta: /opt/farmaecon/backups/pre-scheduler-20261114-165031/ (NÃO …165019, que não existe)
  - farmaecon_db-pre-scheduler.dump (437 KB, pg_restore -l OK)
  - SHA256SUMS (verificar com `cd <pasta> && sha256sum -c SHA256SUMS`)
  - production.env.bak (env antes do deploy) e ROLLBACK_IMAGES (API/WEB f69965b-20261114-153937)
- Rollback da API: `cp -p <pasta>/production.env.bak /opt/farmaecon/.local/production.env` + comando de deploy acima.
- Remover schedules: `queue.removeJobScheduler('orders-sync-<accountId>')` para as 5 contas.

## Ambiente de ensaio
- Projeto: farmaecon-rehearsal-teste
- Compose: /opt/farmaecon/docker-compose.rehearsal.yml
- API: http://127.0.0.1:13001/api/v1/health
- Web: http://127.0.0.1:13000
- Estado: healthy, mas DESATUALIZADO — ainda em farmaecon-api/web:0de434db2b80 (produção já está em f69965b/e33588e).

## Pendências / próximos passos
- Monitorizar nas próximas horas: jobs falhados em bull:marketplace-sync, acumulação na fila, erros ML/tokens
  (1º refresh de token relevante: conta 3fb4ba8a expira ~21:47 UTC de 2026-11-14).
- Reparo menor no scheduler: o 1º tick dispara logo após o registo (2 passagens seguidas à API ML).
- Atualizar o ensaio para as imagens de produção.
- Limpeza possível de imagens antigas sem uso (api:58dede46, web:oauth-redirect-…) — confirmar antes.
- Ollama: adiado; se necessário, instalar localmente, não na VPS.
- Ressalvas pré-deploy antigas: tamanho da imagem API reduzido (2,98 → 1,97 GB); Server Action ainda por rever.
