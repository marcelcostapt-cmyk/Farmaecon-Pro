# Etapas de homologação e checkpoints

Atualizado em 22/09/2026. Cada checkpoint distingue implementação, execução
comprovada e dependências externas. Um teste com fixture não homologa uma conta real.

| Etapa | Critério de saída | Situação |
| --- | --- | --- |
| 0. Retirar credenciais antigas | Código e exemplos sem segredos; revogação e cópias antigas identificadas | Exemplo de produção limpo em `main`; histórico, backups e ambiente remoto ainda exigem tratamento |
| 1. Segurança e validação local | Testes, tipos, builds, duas empresas em PostgreSQL e navegador | Concluída para o incremento local, incluindo RLS; checkpoint 1 |
| 2. Pacote Docker | Banco vazio e atualização com dados, saúde, login, persistência, restore e artefatos preservados | Concluída no CI isolado; checkpoint 2 com imagens e hashes |
| 3. Instalação na VPS | Inventário atual, Traefik preservado, mesmos artefatos, backup e recuperação comprovados | Pacote baixado e hashes conferidos; instalação bloqueada pelo acesso Hostinger |
| 4. DNS e HTTPS | Apenas app/api ajustados após leitura atual; TLS, redirecionamento e navegador verificados | Pendente de acesso e destino atual confirmado |
| 5. Novas credenciais | Credenciais substituídas por canal protegido, callback/PKCE confirmados, nenhuma chave em código ou conversa | Preparador disponível; nenhuma credencial real foi instalada nesta revisão |
| 6. Conta real em Observação | Consentimento no navegador, importação completa, amostra conferida e relatório honesto | Pendente das etapas anteriores e autorização OAuth do titular |

## Etapa 5 — Instalar novas chaves sem expô-las

1. Revogar no provedor as credenciais antigas. A exclusão de arquivos e campos
   no banco não invalida uma chave no Mercado Livre. Tratar separadamente cópias
   no histórico Git, clones e backups; não apagar backups de recuperação sem
   planejar sua substituição. Registrar somente a confirmação e data da revogação.
2. Confirmar, na documentação oficial acessível e na aplicação do desenvolvedor,
   o callback exato `https://app.farmaecon.com.br/auth/callback` e PKCE `S256`.
   A tentativa de leitura da documentação nesta revisão retornou HTTP 403;
   não registrar essa conferência como concluída com base apenas no código.
3. No terminal do ambiente autorizado, com `.local/production.env` existente e
   permissão `0600`, executar:

   ```bash
   npm run credentials:prepare
   ```

   O ID é solicitado localmente e a chave por entrada oculta, com confirmação.
   O comando remove entradas duplicadas dessas variáveis, mantém as chaves JWT,
   do banco, de backup e do cofre, e **mantém `MARKETPLACE_SOURCE=MOCK`**. Não
   inserir access/refresh tokens manualmente nem enviá-los pela conversa.
4. Se houver credenciais antigas no banco, executar o limpador somente com a
   conexão privada correta e uma janela de manutenção aprovada. Ele desconecta
   todas as contas Mercado Livre reais dessa base e invalida states OAuth:

   ```bash
   FARMAECON_CLEAR_MARKETPLACE_CREDENTIALS=confirmed node --env-file=/caminho/privado/environment scripts/clear-marketplace-credentials.mjs --all-mercado-livre
   ```

   O comando exige `DATABASE_URL` no arquivo, imprime apenas contagens e não
   revoga no provedor. Foi preparado para teste em uma base isolada; sua execução
   na VPS deve constar de checkpoint próprio. Não trocar `TOKEN_ENCRYPTION_KEY`
   como forma de remover tokens: isso impediria decifrar dados ainda necessários.
5. Com etapas 1–4 aprovadas e credenciais verificadas, habilitar a fonte real no
   arquivo protegido e aplicar apenas essa configuração à API. Permanecem
   `MARKETPLACE_MODE=OBSERVATION` e a allowlist de OAuth/GET. Executar preflight.
6. O titular abre Integrações, inicia OAuth e autoriza sua conta no navegador do
   provedor. Access e refresh tokens são recebidos pelo callback autenticado e
   cifrados no banco; nunca passam por um formulário de colagem na conversa.

## Etapa 6 — Validação real

- Conferir conta/empresa, período, moeda BRL, fuso, IDs e uma amostra de pedidos
  com a fonte. Registrar somente identificadores mínimos e resultados agregados.
- A sincronização rejeita páginas truncadas, totais instáveis, IDs duplicados,
  datas e valores inválidos. O limite de segurança é 200 pedidos por consulta;
  ao excedê-lo o lote falha sem importar parte dele. Uma conta maior exige
  implementar e homologar particionamento por período antes do aceite.
- Em falha, `lastSyncedAt` conserva a última execução bem-sucedida e o relatório
  informa a tentativa incompleta. Não confundir última tentativa com atualização.
- Preços, anúncios, estoque, campanhas e mensagens permanecem bloqueados.
- Pedidos não equivalem a receita liquidada. DRE, lucro e margem continuam
  indisponíveis enquanto custos, taxas, frete, impostos e reembolsos não tiverem
  cobertura e conciliação comprovadas.

## Registro por etapa

Registrar em `docs/checkpoints/`: data, commit, comandos, resultado, CI/URLs,
origem real ou simulada, arquivos principais, bloqueios e próximo gate. Não
incluir dumps, arquivos de ambiente, tokens, cookies, chaves ou senhas.

Checkpoints confirmados em 22/09/2026:

- [1 — Validação local, PostgreSQL/RLS e navegador](checkpoints/01-local-validation-2026-09-22.md).
- [2 — Docker, migrações, recuperação e imagens](checkpoints/02-docker-recovery-2026-09-22.md).
- [3–6 — Acesso e pré-requisitos externos pendentes](checkpoints/03-remote-prerequisites-2026-09-22.md).

Histórico: [registro intermediário de 21/09/2026](checkpoints/2026-09-21-validation.md).
