ALTER TABLE generation_jobs DROP CONSTRAINT IF EXISTS generation_jobs_status_check;

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_status_check
  CHECK (status IN ('queued', 'running', 'canceling', 'succeeded', 'failed', 'cancelled'));
