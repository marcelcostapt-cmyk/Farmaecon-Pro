-- Gestão de lotes e validades (aditiva): tabela nova + RLS por tenant + grant ao role de runtime.
CREATE TABLE public.product_lots (
  "id"               TEXT NOT NULL,
  "tenant_id"        TEXT NOT NULL,
  "product_name"     TEXT NOT NULL,
  "ean"              TEXT,
  "sku"              TEXT,
  "lot_number"       TEXT NOT NULL,
  "fabrication_date" DATE,
  "expiry_date"      DATE,
  "notes"            TEXT,
  "created_by"       TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_lots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_lots_tenant_fk" FOREIGN KEY ("tenant_id")
    REFERENCES public.tenants("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "product_lots_tenant_expiry_idx" ON public.product_lots ("tenant_id", "expiry_date");
CREATE INDEX "product_lots_tenant_ean_idx" ON public.product_lots ("tenant_id", "ean");

ALTER TABLE public.product_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.product_lots;
CREATE POLICY tenant_isolation ON public.product_lots
  TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_lots TO farmaecon_runtime;
