#!/usr/bin/env bash
# Hardening — cria 3 GB de swap na VPS de produção, de forma idempotente.
#
# NÃO mata processos, NÃO toca em containers, NÃO faz deploy. Aditivo e reversível:
#   sudo swapoff /swapfile && sudo rm /swapfile
#   e remover a linha "/swapfile ... swap ..." de /etc/fstab.
#
# Correr como root NA VPS, só depois de confirmado com o responsável.
set -euo pipefail

SWAPFILE=/swapfile
SIZE_MB=3072

if swapon --show | grep -q .; then
  echo "Swap já ativo — nada a fazer:"
  swapon --show
  exit 0
fi

if [[ -e "$SWAPFILE" ]]; then
  echo "ERRO: $SWAPFILE já existe mas não está ativo. Verificar manualmente antes de prosseguir." >&2
  exit 1
fi

echo "A criar ${SIZE_MB} MB de swap em ${SWAPFILE}..."
fallocate -l "${SIZE_MB}M" "$SWAPFILE" || dd if=/dev/zero of="$SWAPFILE" bs=1M count="$SIZE_MB"
chmod 600 "$SWAPFILE"
mkswap "$SWAPFILE"
swapon "$SWAPFILE"

# Persistir no arranque.
if ! grep -q "^${SWAPFILE} " /etc/fstab; then
  echo "${SWAPFILE} none swap sw 0 0" >> /etc/fstab
fi

# Em servidor, preferir usar swap só sob pressão de memória.
sysctl -w vm.swappiness=10 >/dev/null
grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf

echo "Swap ativo:"
swapon --show
free -m
