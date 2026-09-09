-- Step 5-6: Google Chat approvals and blocked notifications.

-- Run-scoped answer lookup: "has this field already been answered in this run?"
CREATE INDEX IF NOT EXISTS approvals_run_field_idx
  ON approvals (run_id, field_key) WHERE status = 'answered';

-- One pending retry card per application at a time.
CREATE UNIQUE INDEX IF NOT EXISTS approvals_one_pending_retry_idx
  ON approvals (application_id) WHERE type = 'retry' AND status = 'pending';

-- Undelivered alerts are what the dashboard's "needs you" panel reads.
CREATE INDEX IF NOT EXISTS notifications_open_idx
  ON notifications (created_at DESC) WHERE acknowledged_at IS NULL;

ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS responded_by TEXT;
