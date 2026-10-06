-- Resumable, per-account read-only order synchronization.
-- IF NOT EXISTS keeps this migration compatible with the already deployed
-- observation schema, where the last_sync_* columns may already exist.
ALTER TABLE "marketplace_accounts"
  ADD COLUMN IF NOT EXISTS "last_sync_state" TEXT,
  ADD COLUMN IF NOT EXISTS "last_sync_attempt_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_sync_error" TEXT;

CREATE TABLE IF NOT EXISTS "marketplace_sync_states" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "marketplace_account_id" TEXT NOT NULL,
  "operation" TEXT NOT NULL DEFAULT 'ORDERS',
  "status" TEXT NOT NULL DEFAULT 'PARTIAL',
  "next_offset" INTEGER NOT NULL DEFAULT 0,
  "page_size" INTEGER NOT NULL DEFAULT 50,
  "expected_total" INTEGER,
  "imported_count" INTEGER NOT NULL DEFAULT 0,
  "completed_pages" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "marketplace_sync_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_sync_states_tenant_id_marketplace_account_id_operation_key"
  ON "marketplace_sync_states"("tenant_id", "marketplace_account_id", "operation");
CREATE INDEX IF NOT EXISTS "marketplace_sync_states_tenant_id_status_idx"
  ON "marketplace_sync_states"("tenant_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketplace_sync_states_tenant_id_fkey'
      AND conrelid = 'marketplace_sync_states'::regclass
  ) THEN
    ALTER TABLE "marketplace_sync_states"
      ADD CONSTRAINT "marketplace_sync_states_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketplace_sync_states_marketplace_account_id_fkey'
      AND conrelid = 'marketplace_sync_states'::regclass
  ) THEN
    ALTER TABLE "marketplace_sync_states"
      ADD CONSTRAINT "marketplace_sync_states_marketplace_account_id_fkey"
      FOREIGN KEY ("marketplace_account_id") REFERENCES "marketplace_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DROP INDEX IF EXISTS "orders_tenant_id_external_order_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "orders_tenant_id_marketplace_account_id_external_order_id_key"
  ON "orders"("tenant_id", "marketplace_account_id", "external_order_id");
CREATE INDEX IF NOT EXISTS "orders_tenant_id_marketplace_account_id_created_at_idx"
  ON "orders"("tenant_id", "marketplace_account_id", "created_at");
