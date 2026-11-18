#!/usr/bin/env bash
# Hardening — regras de firewall (UFW) para a VPS: SSH + HTTP + HTTPS.
#
# SEGURANÇA: por omissão NÃO ativa a firewall (risco de lockout do SSH).
# Define as regras e mostra o estado; só ativa com o argumento explícito --enable,
# e mesmo assim depois de confirmares que a porta 22 (SSH) está permitida.
#
# NÃO mata processos, NÃO toca em containers. Correr como root NA VPS.
set -euo pipefail

ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH  — tem de ficar aberta ANTES de ativar, senão perdes acesso
ufw allow 80/tcp    # HTTP  (Traefik / desafio ACME Let's Encrypt)
ufw allow 443/tcp   # HTTPS

echo "Regras definidas. Estado atual:"
ufw status verbose || true

if [[ "${1:-}" == "--enable" ]]; then
  ufw --force enable
  echo "Firewall ATIVADA."
  ufw status verbose
else
  echo
  echo ">>> Firewall NÃO ativada (modo seguro)."
  echo ">>> Confirma que a porta 22/tcp está na lista acima e que tens acesso SSH."
  echo ">>> Depois ativa com:  sudo ufw enable   (ou  sudo bash $0 --enable)"
fi
