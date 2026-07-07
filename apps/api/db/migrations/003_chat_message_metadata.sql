ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS message_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_one_active_per_deck_idx
  ON chat_threads (deck_id)
  WHERE status = 'active';
