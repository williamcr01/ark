# @ark/storage

**One job:** persistence. Every read and write of a deck, its chat, its assets, and its generation
jobs goes through here, and nothing here knows about HTTP or the agent.

Layer 4. May import `@ark/deck`, `@ark/chat`, `@ark/runtime-registry`, `@ark/telemetry`.
**Server-only:** it uses `node:sqlite`, `node:fs`, and `node:crypto`, so the renderer must not
import it. That is enforced in `eslint.config.js`. The public entry is `@ark/storage` (`index.ts`);
deep imports remain supported.

```
records/  what is stored     deck, chat, asset, generation-job records; chat persistence,
                             asset resolution and validation, embedded assets,
                             document history snapshots
stores/   how it is stored   deck, chat, workspace, asset, generation-job, preview sessions
fs/       where it lives     data dir, repo root, deck manifest
```

Stored-deck and document-history Zod schemas live in `@ark/deck`
(`document/stored-deck.ts`, `document/document-history.ts`). This package owns how
those browser-safe shapes are persisted.

An Ark workspace is one `.ark` SQLite file per deck. `stores/workspace/` holds the pieces:

| Module               | Responsibility                                                                |
| -------------------- | ----------------------------------------------------------------------------- |
| `schema.ts`          | The SQLite schema, connection configuration, migration, content hash          |
| `types.ts`           | Row shapes, open-file handles, the document-conflict error                    |
| `assets.ts`          | Asset reference tracking, history pins, and grace-period GC                   |
| `history.ts`         | Bounded `document_history` snapshots, seed-on-open, cap eviction              |
| `file.ts`            | Reading a file's rows, metadata, and identity without migrating it            |
| `recent-list.ts`     | Disposable recent-workspaces JSON, list/remove/locate, directory ingest       |
| `document-writer.ts` | `updateDocument`, restore, history reads, and rename history hooks            |
| `thumbnail-files.ts` | Thumbnail read/write/prune and recent-cover updates                           |
| `file-ops.ts`        | Save As, move, duplicate, rename, sqlite backup staging, path/title helpers   |
| `store.ts`           | `WorkspaceStore` — lifecycle, the open-file registry, and collaborator wiring |

`WorkspaceStore` is the public class callers construct. It owns the open-file maps and in-flight
move guard, and delegates recent-list, document, thumbnail, and file operations to collaborators
created in the constructor. The `stores/workspace-store.ts` barrel is unchanged.
