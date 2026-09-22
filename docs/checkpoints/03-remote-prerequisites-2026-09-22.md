# Checkpoint de acesso e pré-requisitos externos

Data: 22/09/2026. **Etapas remotas ainda não concluídas.**

## Hostinger e publicação

A sessão não expõe ferramentas Hostinger/VPS. A descoberta do plugin retornou
lista vazia. Configuração de um servidor MCP não comprova ferramentas carregadas
ou conta autenticada nesta sessão. Nenhuma chamada foi feita à conta por API
alternativa, SSH, script pós-instalação ou browser.

A VPS `1975247`, seu IP, projetos, Traefik, volumes e segredos em execução
precisam ser consultados novamente pelo conector disponível antes de publicar.
Não foi confirmado o inventário remoto, removido token da base remota,
configurado backup remoto ou publicado serviço.

## DNS e HTTPS

- Consultas públicas A, AAAA e CNAME para `app.farmaecon.com.br` e
  `api.farmaecon.com.br`: o resolvedor deste ambiente respondeu `ECONNREFUSED`.
  Isso não comprova inexistência ou falha dos registros.
- `https://app.farmaecon.com.br/login` e
  `https://api.farmaecon.com.br/api/v1/health`: ferramenta de navegação informou
  URLs inacessíveis; não houve verificação de certificado, resolução ou aplicação.
- Proxy, domínio principal, e-mail e demais registros não foram alterados.

## Credenciais e autorização Mercado Livre

- Nenhuma nova chave real instalada. A etapa 5 de
  [validation-stages.md](../validation-stages.md) especifica entrada local oculta,
  arquivo 0600, preservação das demais chaves e manutenção de MOCK até ativação.
- Remoção dos valores antigos do código/exemplos não comprova revogação no
  provedor. Histórico, clones, backups e configurações remotas permanecem fora
  da varredura atual; não declarar "todos os tokens removidos".
- Páginas oficiais de autenticação em português e espanhol retornaram HTTP 403
  na consulta desta sessão. É necessária conferência atual de redirect URI e
  PKCE na documentação acessível e na aplicação do desenvolvedor.
- Depois dos gates de instalação/HTTPS e substituição de credenciais, o titular
  autoriza a conta pelo navegador. Não solicitar tokens ou senhas na conversa.

Nenhuma escrita comercial ou chamada autenticada a conta real de marketplace
foi realizada. O próximo passo executável é disponibilizar o acesso Hostinger
na sessão de trabalho e confirmar revogação/substituição por canal privado.
