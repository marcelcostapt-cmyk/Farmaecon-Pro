-- Auditoria das importações de CSV de ADS (aditiva): ficheiro, contagens, sobreposição e confirmação explícita.
CREATE TABLE public.ads_import_batches (
  "id"                       TEXT NOT NULL,
  "tenant_id"                TEXT NOT NULL,
  "marketplace_account_id"   TEXT NOT NULL,
  "source_hash"              TEXT NOT NULL,
  "file_name"                TEXT,
  "rows_received"            INTEGER NOT NULL,
  "rows_imported"            INTEGER NOT NULL,
  "rows_skipped"             INTEGER NOT NULL,
  "overlap_count"            INTEGER NOT NULL,
  "overlap_confirmed"        BOOLEAN NOT NULL,
  "requested_by"             TEXT,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ads_import_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ads_import_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES public.tenants("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ads_import_batches_marketplace_account_id_fkey" FOREIGN KEY ("marketplace_account_id")
    REFERENCES public.marketplace_accounts("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ads_import_batches_tenant_id_marketplace_account_id_created_idx" ON public.ads_import_batches ("tenant_id", "marketplace_account_id", "created_at");
CREATE INDEX "ads_import_batches_tenant_id_marketplace_account_id_source__idx" ON public.ads_import_batches ("tenant_id", "marketplace_account_id", "source_hash");

ALTER TABLE public.ads_import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.ads_import_batches;
CREATE POLICY tenant_isolation ON public.ads_import_batches
  TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ads_import_batches TO farmaecon_runtime;
