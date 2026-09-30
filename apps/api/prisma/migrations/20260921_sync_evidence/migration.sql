-- Additive migration: preserves existing accounts, orders and credentials.
-- A legacy sync timestamp is not evidence of complete, validated coverage.
ALTER TABLE "marketplace_accounts"
 ADD COLUMN "last_sync_state" TEXT NOT NULL DEFAULT 'NOT_SYNCED',
 ADD COLUMN "last_sync_attempt_at" TIMESTAMP(3),
 ADD COLUMN "last_sync_error" TEXT;
