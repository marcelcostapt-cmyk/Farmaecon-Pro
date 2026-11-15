-- DRE inc 1: indicadores de bonificação e campos fiscais/linha extraídos do XML.
-- Aditiva; novas colunas herdam a RLS já ativa nas tabelas.
BEGIN;

ALTER TABLE public.purchase_invoices
  ADD COLUMN "discounts"    NUMERIC,
  ADD COLUMN "has_bonus"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "bonus_amount" NUMERIC,
  ADD COLUMN "paid_amount"  NUMERIC;

ALTER TABLE public.purchase_invoice_items
  ADD COLUMN "ncm"            TEXT,
  ADD COLUMN "unit"           TEXT,
  ADD COLUMN "discount"       NUMERIC,
  ADD COLUMN "other_expense"  NUMERIC,
  ADD COLUMN "unit_cost_paid" NUMERIC,
  ADD COLUMN "is_bonus"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "paid_quantity"  NUMERIC,
  ADD COLUMN "bonus_quantity" NUMERIC;

COMMIT;
