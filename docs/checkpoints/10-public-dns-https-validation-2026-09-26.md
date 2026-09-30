# Checkpoint 10 — Validação pública DNS e HTTPS

- Data: 2026-09-26
- Modo: OBSERVATION; nenhuma escrita comercial executada.
- DNS confirmado por Cloudflare DoH e Google Public DNS:
  - app.farmaecon.com.br A -> 45.90.109.103, TTL observado 14400.
  - api.farmaecon.com.br A -> 45.90.109.103, TTL observado 1800.
  - api.farmaecon.com.br AAAA -> 2a02:4780:10:f551::1, TTL observado 1800 (decrementando normalmente).
  - teste.farmaecon.com.br AAAA permaneceu no endereço anterior observado, sem alteração.
- HTTP:
  - http://api.farmaecon.com.br/api/v1/health -> 301 para HTTPS.
  - http://app.farmaecon.com.br/ -> 301 para HTTPS.
- HTTPS:
  - A verificação pública neste ambiente retornou 502 do proxy de execução com 'Certificate verify failed: self-signed certificate'.
  - Não foi possível validar o conteúdo de health, frontend ou login via HTTPS.
- IPv6:
  - O resolvedor público anuncia o endereço correto.
  - A conexão IPv6 não respondeu neste ambiente; não é possível distinguir limitação de rede do ambiente de um listener IPv6 ausente no VPS.
- Hostinger/VPS:
  - O inventário atual de containers, Traefik, certificado ACME e logs não foi reconsultado nesta sessão porque as ferramentas Hostinger não estão expostas ao runtime.
  - Nenhum serviço foi reiniciado ou alterado.
- Código:
  - O PR registra validação anterior da stack local, PostgreSQL/RLS, OAuth, frontend, migração, persistência e backup/restore sintéticos; isso não substitui o smoke test público.
- Estado: BLOCKED_PUBLIC_HTTPS e UNVERIFIED_IPV6_CONNECTIVITY.
- Próximo passo:
  1. consultar Traefik/ACME no VPS pelo Hostinger Connector;
  2. corrigir/renovar o certificado público para app e api;
  3. confirmar que Traefik ou o host escuta no IPv6 alvo;
  4. repetir HTTPS, health, readiness, login e relatório;
  5. só então considerar publicação homologada.
- Segredos, tokens e credenciais: não incluídos.