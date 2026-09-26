# Checkpoint 05 — Rede externa ausente na VPS

Data: 25/09/2026. Status: **BLOCKED_NETWORK**.

## Evidência somente leitura

A inspeção realizada no host da VPS Hostinger **1975247** retornou:

- Redes Docker: apenas `bridge`, `host` e `none`.
- `traefik-traefik-1` está ligado somente à rede `host`.
- Não existe uma rede Docker externa nomeada (por exemplo, `proxy`) compartilhável com o Farmaecon.
- Volumes locais: `traefik-letsencrypt` e `traefik_traefik-letsencrypt`; um está ativo e o uso reportado é 0 B.
- Espaço no filesystem: 96 GB totais, 1,8 GB usados e 95 GB disponíveis (2%).
- O projeto Farmaecon não foi criado.

## Decisão

A rede necessária para publicar o Farmaecon atrás do Traefik não está confirmada; ao contrário, a inspeção mostra que ela não existe atualmente. O Traefik usa `network_mode: host`, e não há uma rede externa de proxy à qual os serviços da aplicação possam ser ligados com segurança.

Não vou presumir um nome de rede nem usar `host` para a aplicação, pois isso poderia expor PostgreSQL/Redis e contrariar a arquitetura de redes privadas.

## Ações realizadas

- Nenhum projeto Farmaecon criado ou atualizado.
- Nenhum restart, recreate ou alteração no projeto Traefik.
- Nenhuma alteração de DNS, firewall ou volumes.
- Nenhum segredo, token ou credencial registrado.
- `MARKETPLACE_MODE=OBSERVATION` permanece inalterado.

## Próximo desbloqueio

Antes da publicação, é necessária uma decisão operacional explícita sobre a topologia:

1. criar uma rede externa de proxy e conectar o Traefik a ela (exige alteração no Traefik); ou
2. fornecer outra topologia já suportada, com evidência de como o Traefik alcançará o Farmaecon sem expor serviços internos.

Como a instrução atual proíbe alterar o Traefik, a publicação permanece bloqueada.
