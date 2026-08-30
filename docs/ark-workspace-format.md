# Ark workspace format (`.ark`)

**An .ark file is a portable workspace containing one current presentation, its assets, and its conversations.**

Status: implemented. The legacy-migration phase was intentionally omitted for the pre-production clean break.

```
Quarterly Review.ark
│
├── Workspace metadata
├── Current presentation HTML
├── Presentation assets
├── Threads and messages
├── Thread attachments
└── Current slide thumbnails
```

The file is a SQLite database with an `.ark` extension. It can live anywhere the user chooses.

It does not contain:

- Every historical edit.
- Completed generation-job payloads.
- API keys or credentials.
- UI layout and device-specific state.
- Runtime libraries such as reveal.js or Chart.js.

## Driver

**`node:sqlite` (`DatabaseSync`)** — verified working in Electron 43 (Node 24.18) and system Node 24. No native module, no rebuild step. The online `backup()` API covers Save As, Share Project, and pre-migration backups.

Requires bumping root `engines.node` from `>=22` to `>=24` (Vitest for `apps/api` runs under system Node).

## Product behavior

| User action    | Result                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Create deck    | Creates an `.ark` workspace in the default deck directory immediately                                                  |
| Open `.ark`    | Opens presentation, assets, thumbnails, and threads (in-app Open dialog; OS file associations are out of scope for v1) |
| Save           | Updates the current HTML transactionally                                                                               |
| Save As        | `backup()` to a consistent copy at another location                                                                    |
| Import HTML    | Creates a new `.ark` workspace from the HTML                                                                           |
| Export HTML    | Self-contained presentation, no threads                                                                                |
| Share Project  | Clean new `.ark` containing only selected content                                                                      |
| Delete deck    | Deletes the `.ark` file                                                                                                |
| Move deck      | Moves the single `.ark` file                                                                                           |
| Duplicate deck | Presentation-only or complete-workspace copy                                                                           |

## Schema

One workspace row per file. IDs are UUIDs (existing `UUID_V4_PATTERN`). The workspace ID is the deck ID as far as the HTTP API is concerned — routes stay keyed by it; the file path is not identity.

```sql
CREATE TABLE workspace (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  format_version INTEGER NOT NULL,
  document_revision INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE document (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  html TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_by TEXT,
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(thread_id, sequence)
);

CREATE TABLE blobs (
  checksum TEXT PRIMARY KEY,          -- sha-256 of bytes
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  blob_checksum TEXT NOT NULL REFERENCES blobs(checksum),
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE asset_references (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL,           -- 'document' | 'message'
  owner_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  PRIMARY KEY (asset_id, owner_type, owner_id, purpose)
);

CREATE TABLE thumbnails (
  slide_hash TEXT NOT NULL,           -- content hash of the slide
  renderer_version TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  media_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  image BLOB NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (slide_hash, renderer_version, manifest_hash)
);
```

Schema notes:

- **`messages.content_json` is the existing `persistedChatMessageSchema` payload verbatim** (`parts`, attachments, context, generation status). No new message shape is invented; the existing 50 KB tool-value / 512 KB assistant-turn caps and the persistence projection (`projectAssistantTurnForPersistence`) carry over unchanged. `deckVersionId` is replaced by the workspace `document_revision` at write time.
- **Thumbnails are keyed by slide content hash**, not slide index. Reorder reuse falls out for free; a separate small mapping (or query by hash from the parsed deck) resolves index → thumbnail. Keep the existing 480×270 PNG pipeline and `thumbnail-renderer-vN` versioning.
- **No refcount columns.** Garbage-collect assets/blobs by querying for remaining references at deletion time.
- Do not re-compress image/video/ZIP/PDF blobs.

## Removed features (accepted regressions)

- **Version history and rollback are removed.** The version list/rollback endpoints and UI go away. Undo/redo stays in-memory per editing session (existing `useDeckEditHistory` stack, no longer persisting server versions).
- **Generation-job persistence is removed.** The wire API already strips request/result HTML (`toGenerationJobApi`); jobs are in-memory, terminal deck payloads are trimmed, and old terminal metadata is evicted.
- **No recovery directory.** Every deck is a real `.ark` from creation (default directory, collision-safe name), so there is no "unsaved work without a location" state. SQLite's journal protects committed state; the debounce window (~300 ms) is accepted loss.
- **No named checkpoints in v1.**

## Asset references inside HTML (v1, not deferred)

Canonical HTML stores logical references, never base64:

```html
<img src="ark-asset:image-123" alt="Quarterly revenue chart" />
```

Resolution:

- **Preview / thumbnails**: the sandbox host inlines asset bytes as `data:` URLs when serving the document. This keeps the strict CSP (`default-src 'none'`) untouched and avoids token-authenticated per-asset routes. If serve-time inlining measurably hurts large decks, switch to a render-token-scoped loopback asset route plus an `img-src` CSP allowance later.
- **Export HTML**: same resolver inlines bytes into the standalone file.
- **Editor image insert**: uploads bytes as an asset (checksum-deduped) and emits `ark-asset:` instead of today's base64 embedding (`deck-image.ts` currently only supports `kind: 'data-url'`).
- **Agent**: system prompt and `agent-guides/` teach the model to emit `ark-asset:` IDs for known assets; a save-time extraction pass converts any `data:` URLs the model emits into assets and rewrites the HTML.
- **Validation**: the `external_url` validator learns the `ark-asset:` scheme as allowed; unknown asset IDs are a blocking error.

## Thread and attachment policy

- Attachments are saved by default: blob once, asset metadata, message reference. Promoting an attachment into a slide adds a second reference to the same asset.
- Deleting a thread cascades messages and references; assets/blobs survive while the presentation still references them.
- Keep the existing per-file size limit (50 MiB). No external linked-file mode.
- Multiple threads in the schema from day one, even if the UI shows one. Thread ops: new, rename, archive, delete, mark shared/private.
- `visibility` is an application/sync policy, not encryption — anyone with the file can read the SQLite content. Sharing language must say so: "Export HTML — presentation only" vs "Share Ark Project — may contain prompts, conversations, and source files."
- **Share Project builds a new database from selected rows** (never copy-then-delete: SQLite free pages retain deleted data until vacuumed).

## Save behavior

```
user commits edit → update HTML in memory → debounce ~300 ms
  → BEGIN → replace document row, sync document asset references,
    increment document_revision, touch workspace.updated_at → COMMIT
  → queue changed-slide thumbnails (never blocks save)
```

Immediate flush on: close, deck switch, Present mode, export/share, Save As. Drags/resizes save once per gesture (existing 400 ms nudge coalescing carries over). UI states: Saving… / Saved / Save failed.

Save As / Move / Share into a path that already exists: the API refuses with `409 workspace_file_exists` unless the request sets `overwrite: true`, in which case the existing file is replaced (the "already open" case always refuses with `workspace_already_open` — an open workspace is never clobbered). The renderer asks the user before sending `overwrite: true`, and reopens the dialog at the conflicting path for "choose a different name".

Pragmas:

```
foreign_keys = ON
journal_mode = DELETE      -- no WAL sidecar files; one local writer
synchronous  = FULL        -- relax to NORMAL only after measurement
busy_timeout = a few seconds
application_id = Ark magic number
user_version  = 1          -- plus workspace.format_version
```

Open-version behavior: exact v1 format → open; older, newer, or invalid → reject untouched. No compatibility reader or migration runner ships.

Concurrency: the main process keeps a registry `workspaceId → { path, open handle }` and refuses to open the same path twice. Cloud-synced-folder detection (OneDrive et al.) is **deferred** — v1 targets Linux/macOS.

## Default location and recent index

- Default: `Documents/Ark/`, configurable via native directory picker.
- Collision-safe names: `Untitled Presentation.ark`, `Untitled Presentation 2.ark`.
- The on-disk filename follows the deck title whenever the title changes (user rename in the title bar/dashboard, or an agent-established `<title>` that the UI adopts), **in whatever directory the file lives**. Renames are collision-safe (`Board plan.ark`, `Board plan 2.ark`) and never overwrite.
- Opening a file (Open dialog or Locate) adopts its file name as the deck title when the two diverge — a rename in the file explorer/terminal is treated as the user's latest statement of the deck's name. Collision-safe suffixes (`Board plan 2.ark` vs title `Board plan`) are recognized and leave the title alone.
- Deck-name changes (UI rename, file-name adoption) also rewrite the document `<title>` so the deck name, the file name, and the exported HTML agree. The rewrite bumps `document_revision` only when the document actually changes, and the renderer adopts the returned HTML + revision.
- Support Save As…, Move to…, Reveal in file manager.
- Dashboard = recent-file index at `<userData>/recent-workspaces.json`: workspace ID, path, cached title/updated-time/cover, last opened. Cache is disposable; `.ark` is authoritative. Missing file → "File not found · [Locate] [Remove from recent]". Ark may scan the default directory, never arbitrary drives.

## Import, export, duplicate, share

- **Import HTML**: validate → new `.ark` → store HTML → extract embedded `data:` URLs into assets → rewrite to `ark-asset:` → render thumbnails. External URLs stay blocked.
- **Export HTML**: resolve references, inline bytes, optionally strip scripts. No threads/attachments/metadata.
- **Duplicate**: "presentation only" (HTML + document assets) or "complete workspace" (plus selected threads/attachments). New workspace/thread/message IDs; blobs stay deduplicated and thumbnails regenerate on demand.
- **Share Project**: new database from selected records only.

## Compaction (later)

"Compact Project": GC unreferenced assets/blobs, stale thumbnails, then `VACUUM`, with a by-category size inspector. Never vacuum per-deletion. Not v1.

## Legacy migration

No migration or compatibility reader ships. Pre-`.ark` JSON stores are ignored; this is an intentional pre-production clean break.

## Multiplayer mapping (unchanged from proposal)

workspace/document/threads/messages/assets/blobs/asset_references/thumbnails map 1:1 onto a future server. Prepare with stable UUIDs, authorship fields, visibility, revisions, timestamps. **No CRDTs, op logs, or sync in v1.** In multiplayer the server is authoritative and `.ark` becomes snapshot/backup/import-export.

## What stays outside `.ark`

```
<userData>/
├── auth.json                 # encrypted API keys
├── settings.json             # preferences, default deck location
├── recent-workspaces.json    # disposable dashboard cache
├── cache/                    # regenerable
└── Electron-managed files
```

Plus all device state: window/panel layout, selected slide, open thread, unsent drafts, render queues, model availability.

## Settled decisions log

1. Rollback/version history removed; undo/redo in-memory only.
2. `ark-asset:` scheme ships in v1, not deferred.
3. Cloud-synced-folder hazards deferred; Linux/macOS focus.
4. API stays keyed by deckId (= workspace ID); message shape reuses `persistedChatMessageSchema`.
5. No recovery directory; decks are real `.ark` files from creation.
6. Driver: `node:sqlite`; `engines.node >= 24`.
7. v1 file opening is in-app only; OS file associations later.

---

# Implementation plan

Each phase is independently shippable and lands as its own PR (or small PR series). Existing tests migrate with their stores.

## Phase 1 — SQLite workspace store

New `packages/storage/stores/workspace-store.ts` (or `workspace/` dir): schema DDL, pragmas, `application_id`/`user_version`, open/create/close, strict format validation, and a main-process **workspace registry** (`workspaceId → path + handle`, exclusive open per path). Bump `engines.node` to `>=24`. Pure addition; nothing wired yet. Unit tests against temp files.

## Phase 2 — Decks and chat on `.ark`

Swap `deck-store.ts` and `chat-store.ts` internals to the workspace store; routes and `@ark/contracts` stay keyed by deckId. Remove version endpoints, `rollbackToVersion`, and the rollback UI; `useDeckEditHistory` stops persisting undo/redo as versions. Replace `deckVersionId` in chat writes with `document_revision`. Generation jobs go in-memory. Delete `writeDeckFileWithSnapshot` / `.active` machinery.

## Phase 3 — Assets and `ark-asset:`

Replace `asset-store.ts`/`asset-storage.ts` with checksum-keyed `blobs` + `assets` + `asset_references`. Touchpoints, in order: `external_url` validator learns the scheme → sandbox host serve-time inlining → thumbnail renderer resolution → export inlining → editor image insert (`deck-image.ts` emits `ark-asset:`) → agent prompt/guides + save-time `data:`-extraction pass → HTML import extraction. Biggest phase; the resolver (asset ID → bytes → `data:` URL) is one shared function reused by preview, thumbnails, and export.

## Phase 4 — Thumbnails in `.ark`

Re-key the thumbnail pipeline from `{versionId, manifestHash}` to `{slide_hash, renderer_version, manifest_hash}`, store PNGs in the `thumbnails` table, drop the `<userData>/thumbnails/` cache. Retain queue limits (40 slides, 1.5 MB, concurrency 1).

## Phase 5 — File UX

Default directory setting + native picker, collision-safe naming, Save As (`backup()`), Move to…, Reveal in file manager, in-app Open dialog, `recent-workspaces.json` dashboard replacing `GET /api/decks` directory scan, missing-file Locate/Remove flow, Export HTML / Duplicate / Share Project flows.

## Phase 6 — Legacy migration (intentionally omitted)

No legacy importer, backup directory, or compatibility path is implemented. The old store code is deleted outright.
