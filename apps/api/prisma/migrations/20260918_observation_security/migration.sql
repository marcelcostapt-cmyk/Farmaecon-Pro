ALTER TABLE "marketplace_accounts" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MERCADO_LIVRE', ADD COLUMN "last_synced_at" TIMESTAMP(3);
CREATE TABLE "auth_sessions" (
 "id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL,
 "refresh_hash" TEXT NOT NULL, "expires_at" TIMESTAMP(3) NOT NULL,
 "revoked_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "auth_sessions_user_id_tenant_id_idx" ON "auth_sessions"("user_id", "tenant_id");
CREATE TABLE "oauth_states" (
 "state_hash" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL,
 "session_id" TEXT NOT NULL, "verifier" TEXT NOT NULL,
 "expires_at" TIMESTAMP(3) NOT NULL, "consumed_at" TIMESTAMP(3)
);
CREATE INDEX "oauth_states_expires_at_idx" ON "oauth_states"("expires_at");
