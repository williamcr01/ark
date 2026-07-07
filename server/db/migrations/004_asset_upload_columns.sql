ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS filename text,
  ADD COLUMN IF NOT EXISTS checksum text,
  ADD COLUMN IF NOT EXISTS chat_message_id uuid,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'upload';

CREATE INDEX IF NOT EXISTS assets_chat_message_id_idx
  ON assets (chat_message_id)
  WHERE chat_message_id IS NOT NULL;
