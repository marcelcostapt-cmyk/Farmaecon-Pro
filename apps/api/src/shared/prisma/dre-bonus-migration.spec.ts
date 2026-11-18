import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Verificação estática (SQL não executado): a migration de bonificação é aditiva.
const sql = readFileSync(
  join(__dirname, '../../../prisma/migrations/20261115_dre_bonus_and_fiscal_fields/migration.sql'),
  'utf8',
);

describe('migration de bonificação/fiscais (aditiva)', () => {
  it('adiciona indicadores de bonificação em purchase_invoices', () => {
    expect(sql).toMatch(/ALTER TABLE public\.purchase_invoices[\s\S]*ADD COLUMN "has_bonus"\s+BOOLEAN NOT NULL DEFAULT false/);
    expect(sql).toContain('"bonus_amount"');
    expect(sql).toContain('"paid_amount"');
    expect(sql).toContain('"discounts"');
  });

  it('adiciona indicadores de bonificação e campos de linha em purchase_invoice_items', () => {
    expect(sql).toMatch(/ALTER TABLE public\.purchase_invoice_items[\s\S]*ADD COLUMN "is_bonus"\s+BOOLEAN NOT NULL DEFAULT false/);
    expect(sql).toContain('"paid_quantity"');
    expect(sql).toContain('"bonus_quantity"');
    expect(sql).toContain('"unit_cost_paid"');
  });

  it('é transacional e não recria políticas de RLS (herdadas da tabela)', () => {
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
    expect(sql).not.toContain('ENABLE ROW LEVEL SECURITY');
  });
});
