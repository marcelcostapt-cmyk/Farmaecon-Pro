# Checkpoint 07 — DNS bloqueado por exclusão não seletiva

Data: 26/09/2026. Status: **BLOCKED_DNS_SELECTIVE_DELETE**.

## Estado confirmado

- `app.farmaecon.com.br` A → `45.90.109.103`.
- `api.farmaecon.com.br` A → `45.90.109.103`.
- O registro `api` AAAA antigo permanece inalterado.
- E-mail, `teste` AAAA, TTLs e demais registros permanecem intactos.
- O snapshot DNS contém IPs antigos de `api` e `app`; não foi restaurado.

## Bloqueio

A ferramenta Hostinger disponível para exclusão aceita apenas o domínio e não permite filtrar por nome, tipo e valor. A tentativa de esvaziar somente o `api` AAAA foi rejeitada pela validação e não aplicou mudanças.

Não é seguro usar exclusão ampla ou reset da zona, pois isso poderia remover MX, SPF, DKIM, DMARC e demais registros.

## Estado da publicação

- DNS A está correto para IPv4.
- HTTPS e login público não foram aceitos como concluídos, porque clientes IPv6 ainda podem resolver o AAAA antigo.
- Nenhuma alteração adicional foi feita no DNS, VPS, Traefik ou credenciais.

## Próximo desbloqueio

Usar uma operação que permita atualizar/remover somente o registro `AAAA api`, ou confirmar um IPv6 real da VPS e substituir o valor antigo por esse endereço. Depois validar A/AAAA em resolvedores públicos, certificado, HTTPS, login e API.

