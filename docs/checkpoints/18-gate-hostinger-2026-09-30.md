# Checkpoint 18 — Gate operacional Hostinger

Data: 2026-09-30
Branch: `codex/production-observation-deploy`
VPS alvo: Hostinger 1975247
Modo: `MARKETPLACE_MODE=OBSERVATION`
Fonte: `MOCK`

## Verificações realizadas

- Node disponível no runtime: v24.19.0.
- Os nove blocos `mcp_servers.hostinger-*` estão presentes na configuração local.
- As ferramentas Hostinger/VPS não foram expostas nesta sessão; portanto nenhuma chamada à VPS foi executada.
- Não houve SSH improvisado, escrita na VPS, reinício de Traefik, alteração de DNS ou acesso a credenciais.

## Estado público atual

- `/api/v1/health`: HTTP 200, modo `OBSERVATION`.
- `/api/v1/ready`: HTTP 200.
- `/escritorio`: HTTP 307 para `/login` sem sessão.
- Login com dados de teste inválidos: HTTP 401.
- Relatório sem sessão: HTTP 401.

## Bloqueio

O próximo gate depende da exposição/autenticação do `hostinger-vps-mcp`:

1. confirmar a tag da API/Web carregada nos containers;
2. verificar backup e restauração no host;
3. confirmar persistência após reinício controlado;
4. executar login pelo navegador sem compartilhar credenciais;
5. abrir o relatório autenticado e verificar período, fonte, sincronização e lacunas.

Até esse acesso existir, a publicação da imagem no host e o relatório autenticado permanecem não comprovados. Nenhuma credencial, token ou segredo foi incluído neste checkpoint.
