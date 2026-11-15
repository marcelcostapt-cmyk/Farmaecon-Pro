-- DRE inc 1: importação de documentos de custo (NF-e/planilha) com ciclo de vida
-- e rastreabilidade. Aditiva; estende o contrato de RLS por tenant.
-- Correr com o papel dono da migration; runtime continua não-dono, não-BYPASSRLS.
BEGIN;

CREATE TYPE "PurchaseDocumentSource" AS ENUM ('XML', 'PDF', 'EXCEL');
CREATE TYPE "CostLifecycle" AS ENUM ('EXTRACTED', 'PENDING_REVIEW', 'APPROVED', 'ARCHIVED', 'REJECTED');
CREATE TYPE "AllocationRuleType" AS ENUM ('ZERO_BONUS', 'PROPORTIONAL_SPREAD', 'INCLUDE_EXPENSES', 'MANUAL');

CREATE TABLE public.purchase_invoices (
  "id"                         TEXT PRIMARY KEY,
  "tenant_id"                  TEXT NOT NULL,
  "marketplace_account_id"     TEXT,
  "source"                     "PurchaseDocumentSource" NOT NULL,
  "original_filename"          TEXT NOT NULL,
  "file_hash_sha256"           TEXT NOT NULL,
  "invoice_number"             TEXT,
  "invoice_series"             TEXT,
  "invoice_key"                TEXT,
  "issuer_cnpj"                TEXT,
  "recipient_cnpj"             TEXT,
  "issued_at"                  TIMESTAMP(3),
  "products_total"             NUMERIC,
  "other_expenses"             NUMERIC,
  "document_total"             NUMERIC,
  "payment_amount_in_document" NUMERIC,
  "status"                     "CostLifecycle" NOT NULL DEFAULT 'EXTRACTED',
  "extraction_warnings"        JSONB,
  "created_by"                 TEXT,
  "created_at"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                 TIMESTAMP(3) NOT NULL,
  CONSTRAINT "purchase_invoices_account_fk" FOREIGN KEY ("marketplace_account_id")
    REFERENCES public.marketplace_accounts("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "purchase_invoices_hash_unique" ON public.purchase_invoices ("tenant_id", "file_hash_sha256");
CREATE INDEX "purchase_invoices_status_idx" ON public.purchase_invoices ("tenant_id", "status");

CREATE TABLE public.cost_allocation_rules (
  "id"                  TEXT PRIMARY KEY,
  "tenant_id"           TEXT NOT NULL,
  "purchase_invoice_id" TEXT NOT NULL,
  "rule_type"           "AllocationRuleType" NOT NULL,
  "parameters"          JSONB,
  "approved_by"         TEXT,
  "approved_at"         TIMESTAMP(3),
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cost_allocation_rules_invoice_fk" FOREIGN KEY ("purchase_invoice_id")
    REFERENCES public.purchase_invoices("id") ON DELETE CASCADE
);
CREATE INDEX "cost_allocation_rules_invoice_idx" ON public.cost_allocation_rules ("tenant_id", "purchase_invoice_id");

CREATE TABLE public.purchase_invoice_items (
  "id"                    TEXT PRIMARY KEY,
  "tenant_id"             TEXT NOT NULL,
  "purchase_invoice_id"   TEXT NOT NULL,
  "line_number"           TEXT NOT NULL,
  "source_ref"            TEXT NOT NULL,
  "supplier_product_code" TEXT,
  "ean"                   TEXT,
  "marketplace_sku"       TEXT,
  "description"           TEXT,
  "quantity"              NUMERIC,
  "unit_cost_extracted"   NUMERIC,
  "unit_cost_approved"    NUMERIC,
  "total_line"            NUMERIC,
  "cfop"                  TEXT,
  "lot_number"            TEXT,
  "allocation_rule_id"    TEXT,
  "warnings"              JSONB,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_invoice_items_invoice_fk" FOREIGN KEY ("purchase_invoice_id")
    REFERENCES public.purchase_invoices("id") ON DELETE CASCADE,
  CONSTRAINT "purchase_invoice_items_rule_fk" FOREIGN KEY ("allocation_rule_id")
    REFERENCES public.cost_allocation_rules("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "purchase_invoice_items_unique_line" ON public.purchase_invoice_items ("tenant_id", "purchase_invoice_id", "line_number");
CREATE INDEX "purchase_invoice_items_ean_idx" ON public.purchase_invoice_items ("tenant_id", "ean");

CREATE TABLE public.product_costs (
  "id"                     TEXT PRIMARY KEY,
  "tenant_id"              TEXT NOT NULL,
  "marketplace_account_id" TEXT,
  "ean"                    TEXT,
  "sku"                    TEXT,
  "supplier_code"          TEXT,
  "description"            TEXT,
  "unit_cost"              NUMERIC NOT NULL,
  "is_estimate"            BOOLEAN NOT NULL DEFAULT false,
  "source_invoice_item_id" TEXT,
  "cost_allocation_rule_id" TEXT,
  "valid_from"             TIMESTAMP(3) NOT NULL,
  "valid_until"            TIMESTAMP(3),
  "status"                 "CostLifecycle" NOT NULL DEFAULT 'EXTRACTED',
  "created_by"             TEXT,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_costs_item_fk" FOREIGN KEY ("source_invoice_item_id")
    REFERENCES public.purchase_invoice_items("id") ON DELETE SET NULL,
  CONSTRAINT "product_costs_rule_fk" FOREIGN KEY ("cost_allocation_rule_id")
    REFERENCES public.cost_allocation_rules("id") ON DELETE SET NULL,
  -- Invariante: nenhum custo publicado (APPROVED) sem regra de rateio aprovada.
  CONSTRAINT "product_costs_publish_requires_rule" CHECK (status <> 'APPROVED' OR cost_allocation_rule_id IS NOT NULL),
  CONSTRAINT "product_costs_unit_cost_nonneg" CHECK (unit_cost >= 0)
);
CREATE INDEX "product_costs_lookup_idx" ON public.product_costs ("tenant_id", "marketplace_account_id", "ean", "valid_from");

-- RLS: isolamento por tenant em todas as tabelas; filhas verificam a posse do documento.
ALTER TABLE public.purchase_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.purchase_invoices;
CREATE POLICY tenant_isolation ON public.purchase_invoices
  TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.purchase_invoices TO farmaecon_runtime;

ALTER TABLE public.cost_allocation_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.cost_allocation_rules;
CREATE POLICY tenant_isolation ON public.cost_allocation_rules
  TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')
    AND EXISTS (
      SELECT 1 FROM public.purchase_invoices pi
      WHERE pi.id = cost_allocation_rules.purchase_invoice_id AND pi.tenant_id = cost_allocation_rules.tenant_id
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cost_allocation_rules TO farmaecon_runtime;

ALTER TABLE public.purchase_invoice_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.purchase_invoice_items;
CREATE POLICY tenant_isolation ON public.purchase_invoice_items
  TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')
    AND EXISTS (
      SELECT 1 FROM public.purchase_invoices pi
      WHERE pi.id = purchase_invoice_items.purchase_invoice_id AND pi.tenant_id = purchase_invoice_items.tenant_id
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.purchase_invoice_items TO farmaecon_runtime;

ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.product_costs;
CREATE POLICY tenant_isolation ON public.product_costs
  TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_costs TO farmaecon_runtime;

COMMIT;
