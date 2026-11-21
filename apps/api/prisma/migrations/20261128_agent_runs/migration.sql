-- Escritório de agentes: histórico de execuções reais (aditiva; tabela + enum + RLS + grant).
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'BLOCKED', 'FAILED');

CREATE TABLE public.agent_runs (
  "id"                     TEXT NOT NULL,
  "tenant_id"              TEXT NOT NULL,
  "marketplace_account_id" TEXT NOT NULL,
  "agent_key"              TEXT NOT NULL,
  "status"                 "AgentRunStatus" NOT NULL,
  "block_reason"           TEXT,
  "error_message"          TEXT,
  "result"                 JSONB,
  "requested_by"           TEXT,
  "started_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at"            TIMESTAMP(3),
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES public.tenants("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_runs_marketplace_account_id_fkey" FOREIGN KEY ("marketplace_account_id")
    REFERENCES public.marketplace_accounts("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "agent_runs_tenant_id_agent_key_started_at_idx" ON public.agent_runs ("tenant_id", "agent_key", "started_at");
CREATE INDEX "agent_runs_marketplace_account_id_idx" ON public.agent_runs ("marketplace_account_id");

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.agent_runs;
CREATE POLICY tenant_isolation ON public.agent_runs
  TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_runs TO farmaecon_runtime;
