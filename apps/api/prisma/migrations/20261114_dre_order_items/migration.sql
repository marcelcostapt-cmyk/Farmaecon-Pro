-- DRE inc 1: persist order items + order financial fields (additive, exact decimals).
-- Run with the migration owner role; extends the existing tenant RLS contract.
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN "paid_amount"      NUMERIC,
  ADD COLUMN "ml_date_created"  TIMESTAMP(3),
  ADD COLUMN "ml_date_closed"   TIMESTAMP(3),
  ADD COLUMN "pack_id"          TEXT,
  ADD COLUMN "status_detail"    TEXT,
  ADD COLUMN "ml_payments_raw"  JSONB;

CREATE TABLE public.order_items (
  "id"                    TEXT PRIMARY KEY,
  "tenant_id"             TEXT NOT NULL,
  "marketplace_account_id" TEXT NOT NULL,
  "order_id"              TEXT NOT NULL,
  "ml_item_id"            TEXT,
  "ml_element_id"         TEXT NOT NULL,
  "seller_sku_raw"        TEXT,
  "title"                 TEXT,
  "category_id"           TEXT,
  "variation_id"          TEXT,
  "variation_attributes"  JSONB,
  "quantity"              INTEGER NOT NULL,
  "unit_price"            NUMERIC NOT NULL,
  "gross_price"           NUMERIC,
  "sale_fee"              NUMERIC,
  "listing_type_id"       TEXT,
  "currency_id"           TEXT,
  "product_id"            TEXT,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_items_order_fk" FOREIGN KEY ("order_id") REFERENCES public.orders("id") ON DELETE CASCADE,
  CONSTRAINT "order_items_account_fk" FOREIGN KEY ("marketplace_account_id") REFERENCES public.marketplace_accounts("id") ON DELETE CASCADE,
  CONSTRAINT "order_items_product_fk" FOREIGN KEY ("product_id") REFERENCES public.products("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "order_items_unique_line" ON public.order_items ("tenant_id", "order_id", "ml_element_id");
CREATE INDEX "order_items_account_idx" ON public.order_items ("tenant_id", "marketplace_account_id");
CREATE INDEX "order_items_product_idx" ON public.order_items ("tenant_id", "product_id");

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.order_items;
CREATE POLICY tenant_isolation ON public.order_items
  TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id AND o.tenant_id = order_items.tenant_id
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_items TO farmaecon_runtime;

COMMIT;
