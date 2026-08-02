CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO users (id, email, display_name)
VALUES ('00000000-0000-4000-8000-000000000001', NULL, 'System user')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO workspaces (id, owner_user_id, name)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'Default workspace'
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE decks (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title text NOT NULL,
  active_version_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE deck_versions (
  id uuid PRIMARY KEY,
  deck_id uuid NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  html text NOT NULL,
  title text NOT NULL,
  runtime_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_status text NOT NULL DEFAULT 'unknown'
    CHECK (validation_status IN ('unknown', 'valid', 'invalid')),
  validation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'manual',
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  model_provider text,
  model_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deck_id, version_number)
);

ALTER TABLE decks
  ADD CONSTRAINT decks_active_version_id_fkey
  FOREIGN KEY (active_version_id)
  REFERENCES deck_versions(id)
  ON DELETE SET NULL;

CREATE TABLE chat_threads (
  id uuid PRIMARY KEY,
  deck_id uuid NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  active_deck_version_id uuid REFERENCES deck_versions(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Deck chat',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  deck_id uuid NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  deck_version_id uuid REFERENCES deck_versions(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content_summary text NOT NULL DEFAULT '',
  tool_activity jsonb NOT NULL DEFAULT '[]'::jsonb,
  attachments_metadata jsonb NOT NULL DEFAULT '[]'::jsonb,
  generation_status text,
  message_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assets (
  id uuid PRIMARY KEY,
  deck_id uuid REFERENCES decks(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  chat_message_id uuid,
  filename text,
  source_url text,
  source text NOT NULL DEFAULT 'upload',
  storage_kind text NOT NULL DEFAULT 'local',
  storage_key text,
  media_type text,
  byte_size bigint,
  checksum text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE generation_jobs (
  id uuid PRIMARY KEY,
  deck_id uuid REFERENCES decks(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  chat_thread_id uuid REFERENCES chat_threads(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'canceling', 'succeeded', 'failed', 'cancelled')),
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text,
  model text,
  error_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  result_deck_version_id uuid REFERENCES deck_versions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX decks_workspace_updated_at_idx ON decks (workspace_id, updated_at DESC);
CREATE INDEX decks_owner_updated_at_idx ON decks (owner_user_id, updated_at DESC);
CREATE INDEX deck_versions_deck_created_at_idx ON deck_versions (deck_id, created_at DESC);
CREATE INDEX chat_threads_deck_updated_at_idx ON chat_threads (deck_id, updated_at DESC);
CREATE UNIQUE INDEX chat_threads_one_active_per_deck_idx
  ON chat_threads (deck_id)
  WHERE status = 'active';
CREATE INDEX chat_messages_thread_created_at_idx ON chat_messages (thread_id, created_at ASC);
CREATE INDEX assets_deck_created_at_idx ON assets (deck_id, created_at DESC);
CREATE INDEX assets_chat_message_id_idx
  ON assets (chat_message_id)
  WHERE chat_message_id IS NOT NULL;
CREATE INDEX generation_jobs_deck_created_at_idx ON generation_jobs (deck_id, created_at DESC);
