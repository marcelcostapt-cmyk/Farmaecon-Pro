// Apresentação de resultados de agentes. Valor ausente é mostrado como "indisponível", nunca como zero.
export function displayMetric(value: string | null | undefined, suffix = ''): string {
  return value === null || value === undefined || value === '' ? 'indisponível' : `${value}${suffix}`;
}

export function displayPeriod(inicio: string | null, fim: string | null): string {
  if (!inicio || !fim) return 'sem período (sem dados)';
  return inicio === fim ? inicio : `${inicio} a ${fim}`;
}
