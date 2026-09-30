# Checkpoint 17 — Revalidação pública de continuidade

Data: 2026-09-30
Branch: `codex/production-observation-deploy`
Modo: `MARKETPLACE_MODE=OBSERVATION`
Fonte: `MOCK`

## Verificações públicas

Executadas sem credenciais e sem ignorar a validação TLS:

| Endpoint | Resultado |
|---|---|
| `https://api.farmaecon.com.br/api/v1/health` | HTTP 200 — `{"status":"ok","mode":"OBSERVATION"}` |
| `https://api.farmaecon.com.br/api/v1/ready` | HTTP 200 — `{"status":"ready"}` |
| `https://app.farmaecon.com.br/escritorio` | HTTP 307 para `/login` sem sessão |
| `POST /api/v1/auth/login` com dados de teste inválidos | HTTP 401 — credenciais rejeitadas |
| `GET /api/v1/observation/report` sem sessão | HTTP 401 — relatório protegido |

## Interpretação

- HTTPS, API, readiness e proteção de autenticação estão respondendo publicamente.
- A rota do Escritório Virtual está publicada e exige sessão.
- A rota de relatório existe e exige sessão.
- O conteúdo autenticado do relatório não foi lido; nenhuma senha ou token foi solicitado.
- O modo de marketplace continua observacional/simulado; não houve escrita comercial.

## Pendências

O Hostinger Connector/SSH não está disponível nesta sessão. Ainda não é possível confirmar diretamente:

- a tag efetivamente carregada nos containers da VPS;
- a integridade do backup/restore no host;
- o relatório autenticado com a conta administrativa;
- a persistência observada após reinício no host.

O artefato rastreável já validado permanece documentado no [Checkpoint 16](./16-api-health-escritorio-build-images-2026-09-27.md).

Nenhuma credencial ou segredo foi incluído neste checkpoint.
