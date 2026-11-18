/**
 * Data a partir da qual um custo publicado vale (`product_costs.valid_from`).
 *
 * DEFAULT TEMPORÁRIO DA DECISÃO #5 (vigência da planilha/documento): usa a data de
 * emissão da NF-e e, na sua ausência, a data de importação. Quando a Decisão #5 for
 * tomada, a vigência deve passar a configuração por tenant ou por conta ML — e a troca
 * faz-se SÓ aqui, sem mexer no resto da publicação.
 */
export function resolveValidFrom(invoice: { issuedAt: Date | null; createdAt: Date }): Date {
  return invoice.issuedAt ?? invoice.createdAt;
}
