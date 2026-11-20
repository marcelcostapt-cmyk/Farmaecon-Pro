import { ConflictException } from '@nestjs/common';

export const AccountErrors = {
  SELLER_MISMATCH: 'A conta Mercado Livre autenticada não corresponde a esta integração. Entre com a conta original e tente novamente.',
  RECONNECT_NOT_ALLOWED: 'Só é possível reconectar contas desconectadas.',
  ACCOUNT_NOT_DISCONNECTED: 'Desconecte a conta antes de a remover.',
  ACCOUNT_HAS_ORDERS: 'Não é possível remover esta conta porque possui histórico de pedidos. Desconecte-a para parar a sincronização.',
  ACCOUNT_HAS_PENDING_JOBS: 'Há sincronizações pendentes para esta conta. Aguarde que terminem e tente novamente.',
} as const;

export type AccountErrorCode = keyof typeof AccountErrors;

export const accountConflict = (code: AccountErrorCode) => new ConflictException({ code, message: AccountErrors[code] });
