# Checkpoint 09 — AAAA do API atualizado

- Data: 2026-09-26
- Domínio: `farmaecon.com.br`
- Registro alterado: `AAAA api`
- Novo valor: `2a02:4780:10:f551::1`
- TTL: `1800` segundos
- Resultado informado pelo Hostinger Connector: alteração aplicada e confirmada.
- Registros preservados: todos os demais registros DNS, incluindo `A app`, `A api`, `AAAA teste`, registros de e-mail e domínio raiz.
- Escopo: somente DNS; nenhuma alteração em VPS, Traefik, containers, marketplace ou credenciais.
- Propagação pública: ainda não verificada.
- Pendências de validação:
  1. confirmar `AAAA` em resolvedores públicos;
  2. testar conectividade IPv6;
  3. validar HTTPS/certificado de `api.farmaecon.com.br`;
  4. executar smoke test da API e login sem expor segredos.
- MARKETPLACE_MODE permanece `OBSERVATION`.
- Segredos, tokens e credenciais: não incluídos.
