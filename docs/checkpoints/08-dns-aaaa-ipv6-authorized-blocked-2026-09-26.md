# Checkpoint 08 — AAAA IPv6 autorizado, conector indisponível

- Data: 2026-09-26
- Escopo: substituir somente o registro `AAAA api.farmaecon.com.br`.
- Autorização: confirmada pelo utilizador nesta etapa.
- IPv6 alvo: `2a02:4780:10:f551::1`.
- TTL esperado: 1800 segundos, preservando o TTL atual.
- Registros que devem permanecer intactos:
  - `A app` → `45.90.109.103`
  - `A api` → `45.90.109.103`
  - `AAAA teste`
  - `www`, ALIAS do domínio raiz, MX, SPF, DKIM, DMARC e demais registros.
- Resultado: **BLOCKED_HOSTINGER_CONNECTOR**. O Hostinger Connector não está instalado/conectado nesta sessão; a tentativa de resolução pelo gerenciador de plugins não encontrou uma instalação pública disponível.
- Alterações aplicadas: nenhuma. Não houve escrita DNS, alteração de VPS, Traefik ou serviços.
- Verificação pública: não foi possível obter resposta do resolvedor DNS neste ambiente de execução.
- Próximo passo seguro: reconectar o Hostinger Connector; reler a zona e a lista de snapshots; validar a alteração exata; substituir apenas o `AAAA api`; reler a zona e testar IPv4/IPv6, HTTPS e login.
- Segredos, tokens e credenciais: não incluídos.
