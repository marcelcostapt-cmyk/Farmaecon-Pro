# Checkpoint 15 — Escritório Virtual e regressão de saúde

- Data: 2026-09-27
- Branch: `codex/production-observation-deploy`
- Modo marketplace: manter `OBSERVATION` / `MOCK`
- Credenciais e tokens: não registrados

## Alteração local observada

Foi iniciada a tela `/escritorio`, com componentes de Sidebar, lista de agentes, cena do escritório e badges de estado.

O projeto Web usa o alias:

```text
@/* -> ./src/*
```

Os novos componentes foram criados em `apps/web/components`, fora de `apps/web/src/components`. Por isso o Next.js falhou com `Module not found` para:

- `@/components/layout/Sidebar`
- `@/components/layout/AgentStatusList`
- `@/components/escritorio/OfficeScene`

A compilação local da nova rota não foi concluída.

Também foram instaladas dependências visuais. O `npm audit` reportou 17 vulnerabilidades: 3 low, 4 moderate, 9 high e 1 critical. Nenhuma correção automática foi aplicada.

## Estado remoto informado pelo transcript

- Web: `farmaecon-web:47b57137-escritorio`, healthy
- PostgreSQL: healthy
- Redis: healthy
- Traefik: em execução
- API: `farmaecon-api:58dede46`, unhealthy
- Usuário/tenant de teste continuam presentes; não foram removidos
- `/escritorio`: HTTP 307
- `/api/v1/health`: resposta 404
- `/api/v1/ready`: resposta 404
- Login inválido: resposta 404

A imagem Web ativa diverge da imagem validada anterior. A causa da API unhealthy e dos 404 não foi determinada neste checkpoint; é necessário consultar logs do container API, labels do Traefik, rede `proxy` e o endpoint efetivamente publicado antes de qualquer nova publicação.

## Conclusão

A tela Escritório Virtual não está homologada. O ambiente remoto apresenta uma regressão crítica de disponibilidade da API, portanto o deploy não deve ser considerado aprovado. Nenhuma operação de escrita em marketplace foi executada neste checkpoint.

## Próxima ação segura

1. Corrigir o caminho dos componentes ou o alias TypeScript.
2. Executar build e typecheck locais.
3. Diagnosticar API/Traefik e recuperar `/api/v1/health`, `/api/v1/ready` e autenticação.
4. Só depois reconstruir e publicar a Web, com imagem rastreável e rollback documentado.
