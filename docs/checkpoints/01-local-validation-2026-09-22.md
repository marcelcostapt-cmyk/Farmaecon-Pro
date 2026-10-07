# Checkpoint 1 — Validação da base em Modo Observação

Confirmado em 22/09/2026. **Concluído para o incremento local descrito abaixo.**
Não certifica contas reais, DNS, TLS público nem todos os módulos futuros do produto.

Fonte validada: `ea5939d5befac1f4c38aba4117b0d29cf26f0bff`.
Merge de teste do PR: `58dede46fd98d727e66e15947e321e2e7314a9ad`.
Ambos têm a árvore `ea7d2d4e9e3fb166a425e55e5ac1a2b47f2e7f46`.
[CI aprovado](https://github.com/marcelcostapt-cmyk/Farmaecon-Pro/actions/runs/35550782370),
job `106185007462`; logs consultados e resultados confirmados.

## Evidências

| Verificação | Resultado |
| --- | --- |
| Testes API | 49 testes, 5 suítes, aprovados |
| Preparação privada de credenciais | 4 testes Python aprovados |
| Pacote de produção | 5 testes aprovados e Compose validado |
| TypeScript e builds | API e frontend aprovados |
| PostgreSQL real | Duas empresas com linhas reais de teste; leitura e escrita cruzadas bloqueadas |
| RLS | Ausência de contexto nega acesso; SELECT sem filtro isolado; referência a conta estrangeira rejeitada |
| Papel do banco | Runtime sem ownership/BYPASSRLS; DDL e TRUNCATE negados |
| Pool | 10 transações concorrentes sem mistura de contexto; conexão reutilizada sem tenant residual |
| Sessões | Finalidade, expiração, renovação, replay e revogação aprovados |
| OAuth | State inválido, expirado, de outro usuário/empresa/sessão e reutilizado rejeitado; disputa concorrente tem um único vencedor |
| Cofre e respostas | Tokens cifrados no PostgreSQL; contexto de outra empresa não decifra; respostas públicas sem campos sensíveis |
| Limpeza de tokens | Limpador executado apenas na base isolada; tokens nulos e conta desconectada confirmados |
| Modo Observação | Escrita comercial negada pela allowlist; OAuth e leitura exercitados com respostas sintéticas |
| Navegador Chromium | Login, relatório, cookies HttpOnly, renovação e logout nas duas empresas |
| Qualidade de pedidos | Datas, moeda/valores inválidos, duplicidade e paginação incompleta rejeitados; ausência não vira zero/data atual |

Lint e formatação passaram nos arquivos centrais alterados de autenticação,
Prisma/contexto/interceptor e sincronização. O servidor standalone foi iniciado
localmente pelo caminho real; `/login` e 12 recursos estáticos responderam 200.

## Reproduzir em ambiente local isolado

Pré-requisitos: Node 22+, Docker/Compose e Chromium do Playwright. Executar na
raiz desta versão do repositório, preservando os arquivos privados existentes:

```bash
npm ci
npm exec --workspace api -- prisma generate
npm test --workspace api -- --runInBand
npm run typecheck
npm run build
npx playwright install chromium
npm run local:init
node scripts/runtime-key.mjs .local/observation.env
docker compose --env-file .local/observation.env -f docker-compose.observation.yml up -d --build --wait
npm run local:seed
npm run local:smoke
npm run test:postgres-security
npm run test:migration-upgrade
npm run test:browser
```

Interface: `http://localhost:3000/login`. API local:
`http://127.0.0.1:3001/api/v1/health` e `/api/v1/ready`.
As senhas de teste são aleatórias e ficam no arquivo privado gerado localmente;
não estão no código, nesta documentação ou na conversa.

## Limites que permanecem

- As chamadas do provedor nos testes OAuth usam fixture em processo, sem contas
  reais. O bloqueio de escrita não constitui homologação da API remota.
- A sincronização tem limite de segurança de 200 pedidos e falha integralmente
  ao excedê-lo; contas maiores precisam de particionamento homologado por período.
- DRE/lucro/margem permanecem indisponíveis enquanto a conciliação não estiver
  completa. O relatório é observacional e o analista atual é determinístico.
- A varredura de segredos cobre padrões suportados nos arquivos atuais. Não
  comprova revogação nem remoção de histórico, backups ou runtime remoto.

Próximo gate: [pacote Docker e recuperação](02-docker-recovery-2026-09-22.md).
