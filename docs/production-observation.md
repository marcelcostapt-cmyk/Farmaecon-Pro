# Publicação do Farmaecon em Modo Observação

Atualizado em 20/09/2026. Este procedimento prepara a instalação; não comprova
que a VPS foi alterada. Consultar o resultado do CI do commit a publicar.

## Artefatos e configurações

- `docker-compose.prod.yml`: banco e Redis privados, migração única, API e web.
- `docker-compose.vps.yml`: complemento para o Traefik existente. **Não é mais
  um arquivo independente**; combinar os dois arquivos em todos os comandos da VPS.
- `.local/production.env`: configuração real, ignorada pelo Git e pelo Docker.
- `.env.prod.example`: referência com campos de credenciais vazios.
- A API exige `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` e `TOKEN_ENCRYPTION_KEY`.
  A variável antiga `JWT_SECRET` não atende ao contrato atual.
- `API_INTERNAL_URL=http://api:3001/api/v1` conecta o servidor Next.js à API
  no momento da execução. Não depende de `NEXT_PUBLIC_*` embutido no build.
- `MARKETPLACE_SOURCE=MOCK` é o padrão; `MARKETPLACE_MODE=OBSERVATION` é fixo.
  Cookies mantêm `Secure` em produção (`LOCAL_SIMULATION=false`).

## Preparar a configuração

Pré-requisitos no ambiente de operação: Node 22+ e Docker com Compose v2.
Para uma instalação nova, na raiz do repositório:

```bash
npm run prod:init
```

O comando gera chaves aleatórias em arquivo `0600`, diretório `0700`. Se o
arquivo já existe, ele é preservado. Nunca gerar chaves novas para substituir
as de uma instalação com dados: a senha do volume PostgreSQL não muda com o
arquivo e os tokens cifrados dependem da chave original.

Preencher localmente `OWNER_EMAIL`, imagens da versão validada, domínio,
`TRAEFIK_NETWORK` e `TRAEFIK_CERT_RESOLVER`. Não publicar o arquivo nem colar
seu conteúdo em logs ou conversas. Usar a mesma identidade de projeto Compose
e volumes da instalação anterior, se existir. O padrão novo é `farmaecon`.
O gerador usa senha do banco em base64url para permitir composição segura da
URL; senhas existentes com caracteres especiais exigem tratamento explícito,
nunca troca silenciosa da senha ou do volume.

Inspecionar primeiro o Traefik via Hostinger Connector: resolver ACME, entradas
e modo de rede. Se usa bridge, a rede deve existir e ser acessível ao Traefik.
Se usa rede do host, conferir o acesso do host à bridge escolhida e o endereço
que o provider Docker resolve. Não recriar o Traefik nem supor que a rede
se chama `web`. O complemento usa `traefik.docker.network` explicitamente.

```bash
npm run prod:check
docker compose --env-file .local/production.env -f docker-compose.prod.yml -f docker-compose.vps.yml config --quiet
```

`config --quiet` valida sem imprimir os segredos interpolados. Um resultado
válido não prova DNS, rede existente ou certificado.

## Testar a versão antes da publicação

```bash
npm ci
npm exec --workspace api -- prisma generate
npm test --workspace api -- --runInBand
npm run typecheck
npm run build
npm run test:deployment
docker build -f apps/api/Dockerfile -t farmaecon-api-check:ci .
docker build -f apps/web/Dockerfile -t farmaecon-web-check:ci .
npm run test:production-stack
```

O último comando cria uma instalação **descartável com nome aleatório**, com
portas apenas em loopback e credenciais sintéticas. Testa configurações de
produção, migrações repetidas, bootstrap, login, relatório vazio, reinício de
dependências, backup cifrado e restauração em outro container sem rede. Remove
apenas os volumes que ele próprio criou. Não consulta marketplaces ou DNS real.

O CI também executa o fluxo de observação com duas empresas, permissões e
pedidos simulados em PostgreSQL/Redis. O teste de produção faz login pela API;
ele não equivale à homologação completa do OAuth real ou do navegador com HTTPS.

Promover **as imagens testadas**, sem reconstruí-las depois: atribuir tags do
commit às imagens `farmaecon-api-check:ci` e `farmaecon-web-check:ci`, registrando
seus IDs. Para transportar entre máquinas, usar registro autorizado por digest
ou `docker save`/`docker load` e verificar os mesmos IDs no destino. O CI atual
testa imagens, mas não as publica em um registro automaticamente.

## Instalar e recuperar

1. Consultar novamente VPS, projetos, rede, espaço e volumes existentes.
2. Em atualização, salvar os IDs das imagens anteriores e executar backup e
   teste de restauração antes da migração. Em instalação vazia, fazê-los após
   criar o administrador e antes de conectar qualquer conta real.
3. Conferir compatibilidade das migrações com o rollback previsto.
4. Preencher `API_IMAGE` e `WEB_IMAGE` com as imagens testadas presentes no host.
5. Executar pelo acesso autorizado à VPS:

```bash
docker compose --env-file .local/production.env -f docker-compose.prod.yml -f docker-compose.vps.yml up -d --no-build --pull never --wait --wait-timeout 180
```

6. Apenas na primeira instalação, criar o administrador:

```bash
docker compose --env-file .local/production.env -f docker-compose.prod.yml -f docker-compose.vps.yml run --rm bootstrap
```

O bootstrap exige instalação vazia, usa transação serializável, não imprime a
senha e nunca substitui usuários. Não executar o seed legado de demonstração
na produção. Guardar a senha gerada em gerenciador de senhas; retirar
`OWNER_PASSWORD` do arquivo de operação após o bootstrap.

7. Validar `/api/v1/health`, `/api/v1/ready`, `/login` e login pelo navegador.
8. Em falha, reaplicar apenas as referências de imagens anteriores mantendo
   volumes, nomes de projeto e chaves. Não apagar volumes nem executar reset de
   banco. Se o schema for incompatível com o binário anterior, usar a recuperação
   planejada com cópia restaurada e conferida, nunca sobrescrever o único banco.

## Backup e restauração

```bash
npm run prod:backup
npm run prod:verify-restore -- /caminho/arquivo.pgdump.enc
```

O backup usa `pg_dump` custom e AES-256-GCM; o arquivo tem cabeçalho versionado,
nonce aleatório, autenticação e arquivo de hash SHA-256. A chave de backup é
distinta da chave de tokens. A restauração autentica todo o arquivo antes de
executar SQL e usa um PostgreSQL descartável com `--network none`, limite de
memória e armazenamento temporário. Consulta migrações e tabelas esperadas;
não modifica o banco de produção. Para bancos que excedam a capacidade do teste
descartável, usar um ambiente de recuperação dimensionado e verificar novamente.

O script exige o mesmo nome de projeto Compose do deploy. Se não for
`farmaecon`, definir `FARMAECON_COMPOSE_PROJECT`. Para outro arquivo privado,
definir `FARMAECON_PRODUCTION_ENV` e carregar esse mesmo arquivo com
`node --env-file` ao chamar `scripts/production-backup.mjs`.

Configurar execução diária somente após validar no host. Usar retenção definida
pelo operador e cópia fora da VPS. O script **não agenda**, **não copia para
armazenamento externo** e **não remove backups antigos**. Guardar chaves de
backup e de tokens separadamente dos dumps, em local de recuperação seguro.

## DNS, HTTPS e Mercado Livre

Confirmar novamente VPS `1975247` e IP pelo conector; `45.90.109.103` é o último
endereço observado, não uma consulta atual. Consultar A, AAAA, CNAME e eventual
proxy para `app.farmaecon.com.br` e `api.farmaecon.com.br` antes de alterar. Não
alterar e-mail, domínio principal ou outros serviços. Validar DNS, cadeia TLS,
nomes no certificado, redirecionamento HTTPS e login com cookies seguros.

Antes de habilitar uma conta real:

- Substituir a chave de aplicação Mercado Livre que apareceu no arquivo de
  exemplo versionado. Removê-la da versão atual não a revoga nem limpa o histórico.
- Revisar isolamento: os testes atuais exercitam autorização/filtros na API;
  o schema ainda não implementa PostgreSQL RLS e o usuário de banco da base
  Compose ainda é o proprietário. Separação de papéis/RLS permanece pendente.
- Homologar paginação/cobertura de pedidos e validação de campos financeiros:
  o sync atual é limitado a 200 pedidos e ainda tem fallback para zero em
  valores ausentes. Não certificar DRE ou margem com esses dados.
- Confirmar credenciais atuais, callback exato
  `https://app.farmaecon.com.br/auth/callback`, PKCE S256 e consentimento do
  proprietário pelo navegador. Só então configurar `MARKETPLACE_SOURCE=MERCADO_LIVRE`
  e `ML_PKCE_ENABLED=true`; o modo continua Observação e sem escrita comercial.

## Referências consultadas

- [Ordem de inicialização do Docker Compose](https://docs.docker.com/compose/how-tos/startup-order/)
- [Redes internas e externas do Compose](https://docs.docker.com/reference/compose-file/networks/)
- [Roteamento Docker no Traefik](https://doc.traefik.io/traefik/reference/routing-configuration/other-providers/docker/)
- Next.js 16.2.4: documentação `output` e `self-hosting` incluída no pacote instalado.
