-- Keep the recovery budget across queue retries and worker restarts.
ALTER TABLE "marketplace_sync_states"
ADD COLUMN "pagination_restart_count" INTEGER NOT NULL DEFAULT 0;
