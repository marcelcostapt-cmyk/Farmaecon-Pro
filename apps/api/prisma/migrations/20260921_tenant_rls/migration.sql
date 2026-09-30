-- The application login is never the schema owner. Migration/backup credentials
-- stay outside the API. This role has no cluster administration privileges.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'farmaecon_runtime') THEN
    CREATE ROLE farmaecon_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO farmaecon_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, users, marketplace_accounts,
  orders, products, financial_transactions, auth_sessions, oauth_states TO farmaecon_runtime;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenants TO farmaecon_runtime
  USING (id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (id = nullif(current_setting('app.tenant_id', true), ''));
CREATE POLICY tenant_isolation ON users TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
CREATE POLICY tenant_isolation ON marketplace_accounts TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
CREATE POLICY tenant_isolation ON products TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
CREATE POLICY tenant_isolation ON orders TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND
    EXISTS (SELECT 1 FROM marketplace_accounts a WHERE a.id = marketplace_account_id AND a.tenant_id = orders.tenant_id));
CREATE POLICY tenant_isolation ON financial_transactions TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND
    (order_id IS NULL OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.tenant_id = financial_transactions.tenant_id)));
CREATE POLICY tenant_isolation ON auth_sessions TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND
    EXISTS (SELECT 1 FROM users u WHERE u.id = user_id AND u.tenant_id = auth_sessions.tenant_id));
CREATE POLICY tenant_isolation ON oauth_states TO farmaecon_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND
    EXISTS (SELECT 1 FROM auth_sessions s WHERE s.id = session_id AND s.user_id = oauth_states.user_id
      AND s.tenant_id = oauth_states.tenant_id AND s.revoked_at IS NULL AND s.expires_at > now()));

-- Pre-login tenant is unknown. The sole global lookup returns one exact email
-- to the backend password verifier. It is never an HTTP endpoint.
CREATE FUNCTION public.farmaecon_login_lookup(requested_email text)
RETURNS TABLE (id text, email text, password text, "tenantId" text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT u.id, u.email, u.password, u.tenant_id, u.role::text
      FROM public.users u WHERE u.email = requested_email LIMIT 1 $$;
REVOKE ALL ON FUNCTION public.farmaecon_login_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.farmaecon_login_lookup(text) TO farmaecon_runtime;
