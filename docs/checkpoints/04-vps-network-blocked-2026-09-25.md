# Checkpoint 04 — Pré-publicação VPS bloqueada por rede Docker

Data: 25/09/2026. Status: **BLOCKED_NETWORK**.

## Evidência recebida

A consulta somente leitura da VPS Hostinger **1975247** confirmou:

- VPS em execução, Ubuntu 24.04, 2 CPUs e 8 GB de RAM.
- Único projeto Docker visível: `traefik`.
- Container `traefik-traefik-1`, imagem `traefik:latest`, em execução.
- Traefik usa `network_mode: host`, portas 80/443, redirecionamento HTTP para HTTPS,
  Docker provider com exposição automática desativada e ACME em
  `/letsencrypt/acme.json`.
- O volume declarado `traefik-letsencrypt` e o socket Docker somente leitura foram
  identificados no Compose do Traefik.
- Nenhum projeto Farmaecon aparece na lista.

## Regra de bloqueio

O conector não disponibiliza inventário global de redes Docker, volumes ou espaço do
host. Portanto, não foi possível comprovar a rede externa que o Traefik alcança, a
existência/integridade dos volumes ou a capacidade disponível para a nova stack.

Como o overlay do Farmaecon exige uma rede externa explicitamente nomeada, publicar
com um nome presumido poderia deixar os serviços inacessíveis. A decisão correta é
parar antes da escrita.

## Ações realizadas

- Nenhuma criação ou atualização de projeto.
- Nenhum reinício ou alteração no Traefik.
- Nenhuma alteração de DNS.
- Nenhum segredo, token ou credencial registrado.
- Imagens validadas e artefatos permanecem sem promoção para a VPS.

## Próximo desbloqueio

Obter, por uma ferramenta autorizada de inspeção do host, o nome da rede Docker
compartilhada com o Traefik, volumes existentes e espaço disponível. Depois repetir
o preflight e só então preparar o projeto Farmaecon com as imagens validadas,
segredos fora do Compose, volumes persistentes e backup testado.
