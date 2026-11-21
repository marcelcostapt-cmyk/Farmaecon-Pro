// Erros de navegação do Next (redirect/notFound) têm `digest` e não devem ser engolidos em try/catch.
export function isNextControlError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'digest' in error && String((error as { digest: unknown }).digest).startsWith('NEXT_');
}
