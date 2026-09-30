# Checkpoint 14 — validação VPS, Docker e HTTPS

- Data: 2026-09-27
- Branch: `codex/production-observation-deploy`
- Modo do produto: `OBSERVATION`
- Fonte de marketplace: `MOCK`
- Credenciais e tokens: não registrados neste checkpoint

## Evidências confirmadas por SSH somente para diagnóstico

- Host remoto: `srv1975247`
- Docker Server: 29.7.2
- Recursos informados: 2 CPUs e aproximadamente 7,75 GiB de memória
- Projeto `farmaecon`: API, web, PostgreSQL, Redis e migration
- Projeto `traefik`: container existente preservado
- Rede externa `proxy`: presente e bridge
- Rede privada: `farmaecon_farmaecon-internal`
- Volumes: `farmaecon_pgdata`, `farmaecon_redisdata` e volumes do Traefik

## Containers

- API: saudável, imagem `farmaecon-api:58dede46`
- Web: saudável, atualmente usando a tag manual `farmaecon-web:manual-202609271309`
- PostgreSQL: saudável, sem porta pública
- Redis: saudável, sem porta pública
- Migration: terminou com código 0
- Traefik: em execução, sem recriação ou reinício durante esta validação

## HTTPS e smoke tests

- Certificado de `app.farmaecon.com.br`: Let's Encrypt, verificado, válido até 2026-12-26
- Certificado de `api.farmaecon.com.br`: Let's Encrypt, verificado, válido até 2026-12-26
- Aplicação: HTTP 200 em `/login`
- API: HTTP 200 em `/api/v1/health`, modo OBSERVATION
- Readiness: HTTP 200 em `/api/v1/ready`
- Login inválido: HTTP 401
- A rota `/api/v1/readiness` não existe; a rota correta é `/api/v1/ready`

## Backup e restauração

- Backup PostgreSQL criado: arquivo local na VPS com aproximadamente 23 KiB
- Restauração em banco temporário concluída
- Tabelas restauradas: 9
- Contagem de usuários produção/restaurado: 1/1
- Ainda falta política de permissões restritas, cifragem, cópia fora da VPS, retenção e teste documentado de recuperação completa

## Alteração operacional registrada

O arquivo de ambiente foi alterado para usar uma imagem web manual e foi executado `docker compose up -d web`. Isso recriou o container web e o PostgreSQL usando o volume nomeado; os serviços ficaram saudáveis. O Traefik não foi alterado. A imagem validada `farmaecon-web:58dede46` permanece disponível, mas não é a imagem atualmente selecionada.

## Pendências que bloqueiam a conclusão de produção

1. Revalidar a imagem web manual ou voltar, em janela controlada, para a imagem validada `farmaecon-web:58dede46`.
2. Executar testes positivos de login, renovação e revogação de sessão sem registrar credenciais.
3. Executar teste real de isolamento entre dois tenants e permissões administrativas.
4. Validar OAuth Mercado Livre com conta de teste/real somente leitura, PKCE e state; nenhuma conta real foi conectada neste checkpoint.
5. Corrigir/confirmar a política de backup seguro e repetir o restore após proteção do arquivo.
6. Investigar os erros ACME antigos no log do Traefik; os certificados e o acesso atual estão válidos.

## Conclusão

A infraestrutura pública e o caminho de health/readiness estão operacionais. O sistema ainda não deve ser declarado homologado para uso comercial real porque a imagem web em execução diverge da imagem validada e os testes funcionais de autenticação, tenancy e Mercado Livre real permanecem pendentes.
