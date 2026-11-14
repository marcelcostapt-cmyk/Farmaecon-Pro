# Contexto do Projeto — Farmaecon Pro

## Repositório
- Caminho local: /root/Farmaecon-Pro
- Remote: https://github.com/marcelcostapt-cmyk/Farmaecon-Pro.git
- Branch atual: feature/merge-ml-resumable-sync

## Ambiente de produção (VPS srv1975247)
- Pasta de deploy: /opt/farmaecon
- Containers: farmaecon-api-1, farmaecon-web-1, farmaecon-db-1, farmaecon-redis-1
- Docker Compose prod: /opt/farmaecon/docker-compose.prod.yml

## Ambiente de ensaio
- Projeto: farmaecon-rehearsal-teste
- Compose: /opt/farmaecon/docker-compose.rehearsal.yml
- API: http://127.0.0.1:13001/api/v1/health
- Web: http://127.0.0.1:13000
- Estado: funcional (ambos respondem 200)

## Notas importantes
- /opt/farmaecon não tem .git — é apenas a pasta de deploy/runtime.
- O repositório Git real está em /root/Farmaecon-Pro.
- Imagem alvo em análise: farmaecon-api:0de434db2b80 / farmaecon-web:0de434db2b80.
- Pendências ativas: ressalvas pré-deploy (digests, Server Action, tamanho da imagem API).
