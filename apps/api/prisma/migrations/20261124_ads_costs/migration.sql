-- Custos de ADS (publicidade) importados manualmente (aditiva): tabela nova + RLS por tenant + grant.
CREATE TABLE public.ads_costs (
  "id"                     TEXT NOT NULL,
  "tenant_id"              TEXT NOT NULL,
  "marketplace_account_id" TEXT NOT NULL,
  "day"                    DATE NOT NULL,
  "sku"                    TEXT,
  "campaign"               TEXT,
  "amount"                 DECIMAL(19,4) NOT NULL,
  "source_hash"            TEXT NOT NULL,
  "source_line"            INTEGER NOT NULL,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ads_costs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ads_costs_tenant_fk" FOREIGN KEY ("tenant_id")
    REFERENCES public.tenants("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ads_costs_account_fk" FOREIGN KEY ("marketplace_account_id")
    REFERENCES public.marketplace_accounts("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ads_costs_import_key" ON public.ads_costs ("tenant_id", "source_hash", "source_line");
CREATE INDEX "ads_costs_tenant_day_idx" ON public.ads_costs ("tenant_id", "day");

ALTER TABLE public.ads_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.ads_costs;
CREATE POLICY tenant_isolation ON public.ads_costs
  TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ads_costs TO farmaecon_runtime;
