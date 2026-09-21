# Checkpoint — 21/09/2026

PR: [Farmaecon-Pro #1](https://github.com/marcelcostapt-cmyk/Farmaecon-Pro/pull/1).
Continuação da revisão `cf79bd1`, incorporando a remoção de credenciais de `main`
em `44e0fb7`. Backups e alterações anteriores preservados.

## Etapa 0 — Credenciais antigas

- `.env.prod.example` em `main` foi atualizado com valores de credenciais vazios.
- A varredura dos arquivos atuais não encontrou os padrões suportados de tokens,
  chaves privadas ou campos de segredo preenchidos em exemplos de ambiente.
- Seed legado com senha pública desativado e instrução pública de senha removida
  da interface; simulações usam senhas aleatórias locais.
- Limpador transacional de access/refresh tokens e states preparado para executar
  na base autorizada. Não executado em contas ou bancos reais.
- **Limite:** histórico Git, backups, clones e runtime remoto não foram limpos
  nesta etapa. Revogação no provedor continua a cargo do titular.

## Etapa 1 — Evidência local desta revisão

- API: 49 testes passaram, 5 suítes. Incluem permissões, finalidade/rotação de
  tokens, OAuth, bloqueio comercial, ausência de tokens nas respostas e novos
  cenários de datas, valores e paginação.
- Preparação privada de credenciais: 4 testes Python passaram, incluindo
  preservação das demais chaves, entradas duplicadas, permissões e dados inválidos.
- Checagem TypeScript e builds da API e frontend passaram.
- `start:standalone` executado com o caminho real
  `apps/web/.next/standalone/apps/web/server.js`: `/login` e 12 recursos estáticos
  responderam HTTP 200 em loopback.
- 5 testes do pacote de produção e validação dos dois arquivos Compose passaram.
- Testes adicionais com PostgreSQL real e Chromium adicionados ao CI, aguardando
  o resultado da nova execução antes de declarar conclusão.
- **Pendência de arquitetura:** PostgreSQL RLS e papel de execução sem ownership
  não estão implementados. Testes da API não substituem essa proteção no banco.

## Etapa 2 — Containers

O [CI anterior aprovado](https://github.com/marcelcostapt-cmyk/Farmaecon-Pro/actions/runs/35520529675)
validou as imagens da revisão `cf79bd1`, PostgreSQL/Redis, reinício, backup cifrado
e restore isolado. Isso não comprova os novos scripts desta revisão.

A nova execução acrescenta PostgreSQL com estados OAuth concorrentes, migração
de uma base anterior preenchida e navegador real na stack de observação e na
stack com configuração de produção. Este ambiente de trabalho não dispõe de
daemon Docker; execução de containers deve ser comprovada pelo CI.

## Etapas 3–6 — Pendências externas

- Nenhuma ferramenta Hostinger foi exposta nesta sessão, embora haja servidores
  configurados. VPS, Traefik e DNS não foram consultados novamente pelo conector.
- Nenhuma publicação, edição DNS, credencial nova ou conta real foi efetuada.
- A etapa explícita de instalação de chaves está em
  [validation-stages.md](../validation-stages.md); exige entrada privada e
  consentimento do titular no navegador, após os gates anteriores.
- Documentação oficial Mercado Livre: leitura bloqueada por HTTP 403 nesta
  revisão. Callback e PKCE reais ainda precisam de conferência atual no provedor.
