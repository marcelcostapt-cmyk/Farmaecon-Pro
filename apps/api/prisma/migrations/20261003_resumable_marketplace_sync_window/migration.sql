-- Fixed date_closed windows make offset pagination deterministic for one pass.
-- The current window is retained for retries; the last completed boundary is
-- retained separately for the next pass and its overlap reconciliation.
ALTER TABLE "marketplace_sync_states"
  ADD COLUMN IF NOT EXISTS "window_from" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "window_to" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_synced_window_to" TIMESTAMP(3);
