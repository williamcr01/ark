# @ark/storage

**One job:** persistence. Every read and write of a deck, its chat, its assets, and its generation
jobs goes through here, and nothing here knows about HTTP or the agent.

Layer 3. May import `@ark/deck`, `@ark/chat`, `@ark/runtime-registry`, `@ark/telemetry`.
**Server-only:** it uses `node:sqlite`, `node:fs`, and `node:crypto`, so the renderer must not
import it. That is enforced in `eslint.config.js`.

```
records/  what is stored     deck, chat, asset, generation-job records; chat persistence,
                             asset resolution and validation, embedded assets,
                             document history snapshots
stores/   how it is stored   deck, chat, workspace, asset, generation-job, preview sessions
fs/       where it lives     data dir, repo root, deck manifest
```

An Ark workspace is one `.ark` SQLite file per deck. `stores/workspace/` holds the pieces:

| Module       | Responsibility                                                        |
| ------------ | --------------------------------------------------------------------- |
| `schema.ts`  | The SQLite schema, connection configuration, migration, content hash  |
| `types.ts`   | Row shapes, open-file handles, the document-conflict error            |
| `assets.ts`  | Asset reference tracking and grace-period garbage collection          |
| `history.ts` | Bounded `document_history` snapshots, seed-on-open, cap eviction      |
| `file.ts`    | Reading a file's rows, metadata, and identity without migrating it    |
| `store.ts`   | `WorkspaceStore` — open files, recents, revisions, rename, move, copy |

`WorkspaceStore` stays one class: its open-file maps, recent list, and in-flight move guard are a
single piece of state, and splitting the methods off it would mean threading that state by hand.
