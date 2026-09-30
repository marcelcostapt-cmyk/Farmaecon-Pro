# Checkpoint 2 — Containers, migrações e recuperação

Confirmado em 22/09/2026. **Concluído no ambiente isolado do GitHub Actions.**
Não executado na VPS ou no Mac do titular.

[CI aprovado](https://github.com/marcelcostapt-cmyk/Farmaecon-Pro/actions/runs/35550782370).
Fonte: `ea5939d5befac1f4c38aba4117b0d29cf26f0bff`.
Merge de teste: `58dede46fd98d727e66e15947e321e2e7314a9ad`.

- API, frontend, PostgreSQL e Redis iniciados juntos; health/readiness aprovados.
- Migrações em banco vazio concluídas. Base anterior preenchida com duas
  empresas atualizada duas vezes, preservando IDs, datas e valores, inclusive
  zero explícito; quatro migrações registradas.
- Configuração de produção usa banco/Redis sem portas públicas. A API usa
  identidade restrita; migração/bootstrap usam credencial distinta.
- Bootstrap de instalação vazia passou e a repetição recusou sobrescrever usuários.
- Login, relatório privado, renovação de cookies seguros e logout passaram no
  Chromium. O teste usa loopback; certificado público não foi testado.
- PostgreSQL e Redis reiniciados; dependências voltaram a ready e a sessão
  persistida continuou válida.
- Backup cifrado AES-GCM produzido, decifrado e restaurado em outro PostgreSQL
  sem rede. Migrações, tabelas e as oito tabelas com RLS foram verificadas.
- O procedimento usa apenas volumes descartáveis que o teste criou. Não removeu
  nem alterou volumes da VPS.

## Artefatos preservados para a publicação

[Artefato validado](https://github.com/marcelcostapt-cmyk/Farmaecon-Pro/actions/runs/35550782370/artifacts/10617529383)
`farmaecon-images-58dede46fd98d727e66e15947e321e2e7314a9ad`.

- ID: `10617529383`; 464.553.051 bytes.
- Expiração informada pelo GitHub: 28/09/2026, 01:28:53 UTC.
- SHA-256 do ZIP:
  `a6a4627520b197664ddabffbc398d3d162c6baf5a06fcb922933698255ec3b48`.
- Conteúdo: `images.tar.gz`, `images.ids` e `SHA256SUMS`, sem arquivos de ambiente.
- Imagem API: `sha256:07d34f43fd093996e66b261b8eedc6791fdcc4be35eb352cdbe75758038a6d99`.
- Imagem web: `sha256:bc11a8fcf90239508dcc4ad5f9048f72aea056f88c7d6d311ac3119dff8aeff8`.

Conferir hash do ZIP, depois `sha256sum -c SHA256SUMS`, carregar as imagens e
comparar os IDs no destino antes de promover. Usar essas imagens sem reconstrução.
Se expirarem, repetir a validação e registrar os novos IDs. O artefato não é um
backup de dados da empresa.

## Conferência do pacote baixado — 22/09/2026

O pacote foi recuperado para o ambiente de trabalho e os bytes foram conferidos:

- SHA-256 do ZIP igual ao digest informado pelo GitHub.
- `images.tar.gz` igual ao registro de `SHA256SUMS`:
  `4db8b10c4552cec7a0b76595f9dfce9c27cf6d13d79cfa5c702702c2531188a2`.
- Manifesto Docker contém exatamente API e web. O hash do JSON de configuração
  de cada imagem corresponde ao ID validado acima; ambas são `linux/amd64`.
- Nenhuma das variáveis de segredo da aplicação verificadas está preenchida no
  `ENV` das imagens. Isso não é uma auditoria completa do conteúdo das camadas.
- O ZIP contém somente `images.tar.gz`, `images.ids` e `SHA256SUMS`.

O download HTTP inicial retornou 403; a recuperação do mesmo arquivo pela
integração de arquivos funcionou. O verificador de IDs foi ajustado para tratar
as múltiplas tags registradas em `images.ids`; os IDs em si não divergiram.

Referência estruturada sem credenciais:
[manifesto da versão](../releases/observation-2026-09-22.json).
Essa conferência não executou Docker neste ambiente e não instalou imagens na VPS.
Após a transferência, repetir a conferência no destino, confirmar arquitetura
compatível e atribuir tags específicas da versão antes de iniciar os serviços.

O [CI da revisão de checkpoints](https://github.com/marcelcostapt-cmyk/Farmaecon-Pro/actions/runs/35766524411)
também concluiu com sucesso para `d4206f5dc7571bcf77faa8e321c34530e377aead`.
O pacote selecionado continua sendo o da execução `35550782370`; não misturar
IDs de imagens produzidas por execuções diferentes.

## Gate para a VPS

Seguir [o runbook de instalação](../production-observation.md), incluindo
inventário atualizado, Traefik, rede, espaço, volumes, chaves protegidas,
backup fora da VPS e teste de recuperação no ambiente de destino. Essa etapa
permanece bloqueada pela ausência das ferramentas Hostinger nesta sessão.
