# Checkpoint 13 — Diagnóstico SSH executado no Mac

- Data: 2026-09-27
- Fonte: arquivo Markdown fornecido pelo utilizador.
- Resultado principal: os comandos Docker, redes, volumes, disco e portas não foram executados na VPS.
- Evidência: o prompt local `marcel@MBP-de-MARCEL FARMAECON PRO %` recebeu o texto `root@srv1975247:~#` como se fosse um comando; o shell respondeu `zsh: command not found`.
- Consequência: `docker`, `ss` e `/docker` foram procurados no Mac e não constituem diagnóstico remoto.
- DNS/HTTP observado no Mac: API respondeu 308 redirecionando para HTTPS.
- TLS observado no Mac: validação falhou com `unable to get local issuer certificate` nas tentativas IPv4 e IPv6.
- Alterações remotas: nenhuma.
- Próximo passo seguro:
  1. executar `ssh root@45.90.109.103`;
  2. confirmar `hostname` como `srv1975247` e `whoami` como `root`;
  3. somente depois executar os comandos Docker/Traefik de leitura.
- Segredos, tokens e credenciais: não incluídos.