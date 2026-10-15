import { Prisma } from '@prisma/client';

const literal = value => `'${value.replaceAll("'", "''")}'`;

// The generated schema is the inventory, not a second hand-maintained table list.
// Return one atomic SQL statement usable by both pg.Client and isolated psql.
export function runtimeGrantsSql(models = Prisma.dmmf.datamodel.models) {
  const tables = models.map(model => model.dbName || model.name);
  if (!tables.length || tables.some(name => typeof name !== 'string' || !name || name.startsWith('_prisma_'))
    || new Set(tables).size !== tables.length) throw new Error('Invalid application table inventory');

  const body = `
DECLARE
  application_tables constant text[] := ARRAY[${tables.map(literal).join(', ')}];
  table_name text;
  runtime_oid oid;
  privileges text;
BEGIN
  SELECT oid INTO runtime_oid FROM pg_roles
    WHERE rolname = 'farmaecon_runtime' AND NOT rolsuper AND NOT rolbypassrls
      AND NOT rolcreatedb AND NOT rolcreaterole;
  IF runtime_oid IS NULL THEN
    RAISE EXCEPTION 'Restricted runtime role required before grant reconciliation';
  END IF;

  -- Fail closed for a missing/unprotected model, before granting anything.
  -- This checks existing RLS; it never creates, changes or disables a policy.
  FOREACH table_name IN ARRAY application_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name AND c.relkind IN ('r', 'p')
        AND c.relrowsecurity AND c.relowner <> runtime_oid
        AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
          AND p.polname = 'tenant_isolation' AND runtime_oid = ANY(p.polroles))
    ) THEN
      RAISE EXCEPTION 'Application table % lacks the existing runtime isolation contract', table_name;
    END IF;
  END LOOP;

  GRANT USAGE ON SCHEMA public TO farmaecon_runtime;
  FOREACH table_name IN ARRAY application_tables LOOP
    -- Preserve the existing checkpoint contract: synchronization never deletes it.
    privileges := CASE WHEN table_name = 'marketplace_sync_states'
      THEN 'SELECT, INSERT, UPDATE' ELSE 'SELECT, INSERT, UPDATE, DELETE' END;
    EXECUTE format('GRANT %s ON TABLE public.%I TO farmaecon_runtime', privileges, table_name);
  END LOOP;

  -- A no-ACL restore otherwise restores the default PUBLIC EXECUTE permission.
  REVOKE ALL ON FUNCTION public.farmaecon_login_lookup(text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.farmaecon_login_lookup(text) TO farmaecon_runtime;
END;
`;
  // Pick a delimiter absent from the body, including any quoted model names.
  let tag = 'runtime_grants';
  while (body.includes(`$${tag}$`)) tag += '_';
  return `DO $${tag}$${body}$${tag}$;`;
}
