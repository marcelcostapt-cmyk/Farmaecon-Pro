-- Extend the existing tenant RLS contract; run with the migration owner role.
-- No credentials, new tenant setting, or data updates are introduced here.
BEGIN;

ALTER TABLE public.marketplace_sync_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.marketplace_sync_states;
CREATE POLICY tenant_isolation ON public.marketplace_sync_states
  TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')
    AND EXISTS (
      SELECT 1 FROM public.marketplace_accounts a
      WHERE a.id = marketplace_sync_states.marketplace_account_id
        AND a.tenant_id = marketplace_sync_states.tenant_id
    )
  );

-- Sync reads, creates and updates checkpoints; it never deletes them.
GRANT SELECT, INSERT, UPDATE ON TABLE public.marketplace_sync_states
  TO farmaecon_runtime;

COMMIT;
