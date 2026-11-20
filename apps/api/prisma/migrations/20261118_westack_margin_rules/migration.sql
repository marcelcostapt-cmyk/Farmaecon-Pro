-- WeStack: regras de margem mínima por tenant (aditiva; só cria tabela + RLS + grant).
CREATE TABLE public.margin_rules (
  "id"                 TEXT NOT NULL,
  "tenant_id"          TEXT NOT NULL,
  "sku"                TEXT,
  "min_margin_percent" DECIMAL(19,4),
  "min_margin_amount"  DECIMAL(19,4),
  "created_by"         TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "margin_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "margin_rules_tenant_fk" FOREIGN KEY ("tenant_id")
    REFERENCES public.tenants("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "margin_rules_tenant_sku_key" ON public.margin_rules ("tenant_id", "sku");
CREATE INDEX "margin_rules_tenant_idx" ON public.margin_rules ("tenant_id");

ALTER TABLE public.margin_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.margin_rules;
CREATE POLICY tenant_isolation ON public.margin_rules
  TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.margin_rules TO farmaecon_runtime;
