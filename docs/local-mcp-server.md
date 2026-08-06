# Local MCP server

Implementation plan for [issue #275](https://github.com/williamcr01/ark/issues/275).

## Status

Implemented. This document describes the first production scope and its implementation. The
first release lets Codex, Claude Code, and other local MCP clients edit the presentation currently
open in Ark. Opening existing presentations and creating new ones through MCP are follow-ups.

## Product behavior

Ark exposes an **External agents (MCP)** control in the deck toolbar and in Settings.

When a deck is open, the user can:

1. Select **Start MCP server**.
2. Copy a generated setup command for Codex or Claude Code.
3. Ask that client to edit the presentation currently visible in Ark.
4. Watch the preview and thumbnails update after each successful MCP edit.
5. Select **Stop MCP server** to revoke access.

Settings also contains **Start MCP server when Ark opens**. It is off by default. Manual start is
session-only; automatic start persists as a desktop setting.

The external conversation remains in Codex or Claude Code. Ark shows connection and tool activity,
but does not copy the external conversation into Ark chat. The external client uses its own account
and authentication, so Ark provider API keys are not required.

### Proposed UI states

Stopped:

```text
External agents (MCP)
Let Codex or Claude Code edit the presentation currently open in Ark.

Status: Stopped
[ Start MCP server ]

[ ] Start automatically when Ark opens
```

Running:

```text
External agents (MCP)

Status: Running
Sharing: Quarterly Review
Last activity: Codex patched 2 slides

[ Stop MCP server ]

[x] Start automatically when Ark opens

Codex
codex mcp add ark -- "/path/to/Ark" --headless --mcp
[ Copy command ]

Claude Code
claude mcp add --transport stdio --scope user ark -- "/path/to/Ark" --headless --mcp
[ Copy command ]
```

Ark generates an absolute, platform-correct executable path. The commands are examples, not
hard-coded strings. The setup command is needed once; starting or stopping the service later does
not modify client configuration.

The deck toolbar should show a small status indicator while MCP is enabled. Settings owns the
autostart preference and detailed status. The toolbar control remains the fastest contextual entry
point because v1 shares only the visible deck.

## Process model

```text
Codex / Claude Code
        |
        | MCP over stdio
        v
Ark executable --mcp
        |
        | authenticated HTTP on Ark's random loopback origin
        v
Embedded Ark API and MCP tool runner
        |
        +-- current deck tools and validation
        +-- optimistic revision check
        +-- .ark SQLite workspace persistence
        |
        v
Electron IPC external-update event
        |
        v
Renderer refreshes preview, thumbnails, and undo history
```

There are two distinct processes:

- The normally launched Ark process owns the window, embedded API, workspace databases, MCP
  enablement state, and persistence.
- The MCP client launches a second Ark process with `--mcp`. This process is a small stdio bridge.
  It does not create a window, acquire the normal single-instance lock, or open `.ark` files.

The bridge exits when its client closes stdin or terminates it. The main Ark process continues
according to its normal lifecycle. Quitting Ark disables the service; it does not leave a server
running in the background.

### Why use `Ark --mcp`

Ark's packaged API already listens on `127.0.0.1` with a random port. A client configuration that
points directly at that URL would become stale after every restart. A fixed HTTP port would add
port-collision handling and a permanently discoverable localhost endpoint.

The stdio bridge gives clients a stable command while allowing Ark to retain its random loopback
origin. It also avoids requiring Node.js, npm, a separately installed `ark-mcp` binary, OAuth, or a
token pasted into client configuration.

`--mcp` is not how users normally launch Ark. Codex or Claude Code invokes it automatically after
the setup command has been added.

## Service lifecycle

The Electron main process owns an MCP server manager with these states:

- `stopped`: external tool execution is disabled and no discovery record is valid.
- `running`: a discovery record and session capability are active.
- `stopping`: new calls are rejected while the capability is revoked and state is removed.

Starting the service:

1. Generate a cryptographically random session capability.
2. Write an atomic runtime discovery record under Electron `userData`.
3. Enable the authenticated internal MCP routes.
4. Publish the current active deck, if any.
5. Notify the renderer that the service is running.

Stopping the service:

1. Revoke the in-memory capability before changing the UI state.
2. Remove the discovery record.
3. Reject subsequent bridge requests with a clear `MCP_DISABLED` error.
4. Notify the renderer that the service stopped.

Autostart runs the same start operation after the embedded API and settings store are ready. It does
not start a second background daemon. If no deck is open, the server remains available and
`get_active_deck` reports that the user must open a presentation.

The bridge must initialize over stdio even when Ark is stopped. Its tool definitions are bundled,
so it can return an actionable tool error and recover after the user starts MCP in Ark without
requiring the Codex or Claude session to be restarted.

## Runtime discovery and authentication

While the service is running, Ark writes a record such as:

```json
{
  "schemaVersion": 1,
  "apiOrigin": "http://127.0.0.1:49152",
  "pid": 12345,
  "sessionCapability": "high-entropy-secret",
  "startedAt": "2026-08-06T12:00:00.000Z"
}
```

Requirements:

- Write with an atomic temporary-file rename.
- Restrict file permissions to the current OS user where the platform supports explicit modes.
- Never log or expose the capability to the renderer.
- Store it only while MCP is enabled; do not put it in persistent desktop settings.
- Validate the capability with a constant-time comparison on every internal MCP request.
- Re-read discovery before calls so the bridge survives an Ark restart and random-port change.
- Treat a missing record, stale PID, failed health check, or rejected capability as recoverable.
- Remove stale records during Ark startup before optionally enabling autostart.

Internal MCP routes require `Authorization: Bearer <sessionCapability>`, reject unexpected `Origin`
headers, validate the loopback host, retain existing request limits, and never listen on a second
network interface. The MCP client identity is useful provenance but is not authentication.

Stopping MCP only revokes MCP access. It must not stop the embedded API used by the Ark renderer.

## Active deck scope

Version one exposes only the deck currently visible in the Ark window.

The renderer publishes the active deck id to Electron main over the preload bridge whenever route
selection changes. Main stores that id in a small in-memory active-deck state shared with the API's
MCP runner. The API verifies that the id still resolves to an open workspace before every tool call.

Rules:

- Read tools default to the active deck and return its resolved `deckId` and `documentRevision`.
- Mutating tools include the returned `deckId` and `expectedDocumentRevision`.
- A mutation is rejected if the deck is no longer active under the default permission scope.
- Switching decks changes the active target for new reads; it never retargets an in-flight write.
- File paths are not returned to the model in v1.
- Starting MCP without an active deck is allowed, but edit tools return a clear error.

This scope makes the permission understandable: if the user can see the presentation in Ark, the
external agent can edit it. All-deck access requires a separate future permission and is not hidden
behind the v1 toggle.

## MCP tool surface

The MCP surface reuses Ark's current operation names, descriptions, schemas, parsing, patching, and
validation behavior wherever possible. MCP adds a target/revision envelope because the built-in
agent already owns a deck-scoped in-memory workspace while an external process does not.

| Tool                   | Behavior                                                        | Mutating |
| ---------------------- | --------------------------------------------------------------- | -------- |
| `get_authoring_guide`  | Return MCP-safe deck authoring and runtime guidance             | No       |
| `get_active_deck`      | Return id, title, revision, slide count, origin, and MCP status | No       |
| `parse_deck`           | Return structured deck metadata and editable element ids        | No       |
| `list_slides`          | Return slide ids, indexes, and titles                           | No       |
| `read_deck`            | Return paged HTML or one slide                                  | No       |
| `patch_deck`           | Apply structured slide operations; preferred for slide edits    | Yes      |
| `patch_element`        | Apply element operations using stable element ids               | Yes      |
| `edit_deck`            | Apply exact unique old-text to new-text edits                   | Yes      |
| `write_deck`           | Replace a blank deck or perform an explicit full rewrite        | Yes      |
| `ask_user`             | Show structured questions in the visible Ark deck               | UI only  |
| `propose_themes`       | Show four validated visual theme samples in Ark                 | UI only  |
| `wait_for_interaction` | Wait briefly for an Ark question or theme response              | No       |

The first release deliberately omits:

- attachments: add after the active-deck path is stable.
- generation-job tools: an external agent should not delegate back to Ark's built-in agent.
- versions and rollback tools: Ark currently has session undo/redo, not persistent immutable deck
  versions.

Every tool result includes short text for broad client compatibility and structured content for
reliable follow-up calls. Mutation results include:

- resolved deck id;
- previous and current document revisions;
- applied operation count and summary;
- changed slide indexes and element ids when relevant;
- validation warnings;
- a recoverable error code when unsuccessful.

Tool execution errors should tell the model what to do next: open a deck, start MCP, re-read after a
revision conflict, correct invalid HTML, or retry a uniquely targeted edit. Tool inputs retain the
same size and operation-count limits as Ark's built-in tools.

## Reusing the existing tool implementation

Do not create a second deck editor in `apps/mcp`.

The bridge owns MCP framing only. It forwards a tool name, validated arguments, and MCP client
metadata to an authenticated internal runner in `apps/api`. The internal runner:

1. Resolves and authorizes the active deck.
2. Reads the current HTML and document revision.
3. Creates a `DeckWorkspace` snapshot.
4. Executes the corresponding existing deck tool.
5. If the tool is read-only, returns its projected result.
6. If it mutated successfully, conditionally persists the resulting HTML.
7. Emits persistence, thumbnail, activity, and renderer-update notifications.

The current `createDeckTools` closure must not be used as persistence by itself: it changes only its
in-memory `DeckWorkspace`. The MCP runner is the adapter that turns a successful workspace mutation
into one conditional `.ark` document write.

Extract the MCP-safe names, descriptions, and wrapper schemas into a shared catalog that both the
API adapter and `apps/mcp` can import. This lets the bridge initialize while Ark is stopped without
fetching a runtime manifest, while still avoiding separately maintained descriptions. Add the MCP
target/revision fields in that wrapper schema and keep the internal agent's deck-scoped inputs
unchanged. Tool execution and persistence remain in `apps/api`; the shared catalog contains no deck
business logic.

## Concurrency and data-loss prevention

MCP writes must not ship with last-writer-wins behavior.

Add `expectedDocumentRevision` to update and structured-patch persistence. The SQLite write must
perform its revision check inside the same `BEGIN IMMEDIATE` transaction that writes the document.
Conceptually:

```sql
UPDATE workspace
SET document_revision = document_revision + 1, updated_at = ?
WHERE id = ? AND document_revision = ?;
```

The actual implementation also updates the document, title, origin, assets, and timestamps in the
existing transaction. If the expected revision no longer matches, roll back and return HTTP 409
with a stable conflict code and the current revision.

The MCP runner checks before executing for fast feedback and the store checks again at commit time
for correctness. The renderer's normal update and patch requests must also send their expected
revision; otherwise a later Ark UI save could still overwrite an MCP edit.

On conflict, the tool response instructs the agent to call `get_active_deck`, `parse_deck`, or
`read_deck` and retry against the new revision. Do not automatically replay edits because slide
indexes or exact text may have changed.

## Live renderer updates

The Electron shell is the only product shell, so use the existing preload/IPC boundary rather than
adding an SSE subsystem for v1.

After a successful MCP write, the API calls a persistence callback containing:

```ts
type ExternalDeckUpdate = {
  deckId: string
  previousDocumentRevision: number
  documentRevision: number
  clientName: string | null
  toolName: string
  summary: string
}
```

Electron main sends this event to the renderer. The preload exposes a subscribe/unsubscribe API,
not raw `ipcRenderer`.

When the event targets the visible deck, the renderer:

1. Fetches the authoritative deck at the announced revision.
2. Ignores duplicate or older events.
3. Records one undo boundary using the previously rendered HTML and the fetched HTML.
4. Updates the deck state and `documentRevision`.
5. Preserves the current slide when it still exists.
6. Lets the existing revision-keyed thumbnail flow load updated thumbnails.
7. Shows a short activity indicator such as `Updated by Codex`.

If a local mutation is still in flight, the renderer waits for it to settle and then compares
revisions. A conflict is surfaced instead of replacing unsaved local state. MCP changes participate
in the existing in-memory undo/redo model; persistent revision history remains a separate feature.

## Server instructions and authoring quality

External clients do not receive Ark's built-in agent system prompt or always-on guides. The MCP
server instructions therefore tell the client to load the MCP-safe guide once before its first edit
in each conversation, then state:

1. Call `get_authoring_guide` once before the first edit in the conversation.
2. Call `get_active_deck`, then parse or list slides before targeted edits.
3. Prefer `patch_deck`; use `edit_deck` for small exact edits and `write_deck` only for explicit
   rewrites.
4. Carry `deckId` and `documentRevision` from reads into writes.
5. Produce one self-contained HTML document with no external resource URLs.
6. Use approved `/api/runtimes/...` assets and existing Ark asset URLs only.
7. Re-read and retry after a revision conflict.

Keep the first 512 characters self-contained for clients that prioritize or truncate server
instructions. `get_authoring_guide` returns the live runtime registry plus the packaged
`mcp-guides/` documents. Those documents mirror `agent-guides/` but replace internal-only tools
with the equivalent external-client workflow. Do not duplicate every guide into every tool
description.

## Desktop integration

Electron main owns operations that require OS or process knowledge:

- start and stop the MCP service;
- persist the autostart preference;
- generate the discovery capability;
- resolve the packaged executable path;
- generate Codex and Claude Code commands;
- track status and sanitized client activity;
- enter `--mcp` mode before normal single-instance/window startup.

The preload should expose a narrow API similar to:

```ts
type McpDesktopApi = {
  getStatus(): Promise<McpStatus>
  start(): Promise<McpStatus>
  stop(): Promise<McpStatus>
  setAutoStart(enabled: boolean): Promise<McpStatus>
  setActiveDeck(deckId: string | null): Promise<void>
  getSetupCommands(): Promise<{ codex: string; claudeCode: string }>
  onStatusChanged(listener: (status: McpStatus) => void): () => void
  onDeckUpdated(listener: (update: ExternalDeckUpdate) => void): () => void
}
```

Exact types belong in shared contracts where they cross the renderer/main boundary. Do not expose
the API origin or session capability through this interface.

The settings store gains one durable boolean, defaulting to false. Running state, active deck,
clients, token, origin, and activity are process-local state.

The UI should initially provide copy buttons rather than modifying third-party configuration files
directly. A later one-click installer may invoke the official `codex mcp add` and `claude mcp add`
commands with argument arrays and `shell: false`; it should still keep copyable commands as the
fallback.

## Package and dependency shape

Add an `apps/mcp` workspace package for the stdio bridge. It may depend on:

- `@ark/contracts` for shared result and error shapes;
- `@ark/deck-core` for portable MCP wrapper schemas if needed;
- the official `@modelcontextprotocol/server` v2 package;
- Zod 4 already used by Ark.

It must not import `apps/api`, open workspace files, or contain deck business logic. The desktop
main build bundles the bridge and enters it through `Ark --mcp`, so packaged users install no second
runtime. Add the MCP package only after checking the exact released dependency version, license,
lockfile changes, and Electron packaging output.

Development may use a direct workspace command such as `pnpm --filter @ark/mcp dev`, but production
smoke tests must exercise the packaged Ark executable with `--mcp`.

## Observability and privacy

Record structured events without full HTML, capabilities, or sensitive tool arguments:

- `mcp.service.started`
- `mcp.service.stopped`
- `mcp.client.connected`
- `mcp.tool.started`
- `mcp.tool.succeeded`
- `mcp.tool.failed`
- `mcp.tool.conflict`

Useful fields are client name/version, tool name, deck id, previous/current revision, duration,
operation counts, and error category. Sanitize client-provided names before displaying them. The UI
keeps only a small in-memory recent-activity list in v1.

## Implementation phases

### Phase 1: safe multi-writer persistence

- Extend deck update and patch contracts with expected revision support.
- Add an atomic revision mismatch result to `WorkspaceStore.updateDocument`.
- Return HTTP 409 with a stable error code and current revision.
- Update renderer saves and patches to send their current revision.
- Add route, store, contract, and renderer conflict tests.

This phase is required before any MCP mutation is enabled.

### Phase 2: active deck and renderer notifications

- Add process-local active-deck state.
- Publish route deck changes through preload IPC.
- Add a composed document-persisted callback from API to Electron main.
- Add external-update IPC and renderer subscription.
- Refresh the visible deck, record undo history, and preserve slide position.
- Test external updates, duplicate events, deck switches, and in-flight local mutations.

### Phase 3: authenticated internal MCP runner

- Add service capability validation and MCP-only internal routes.
- Add `get_active_deck`.
- Adapt the existing deck tool catalog to active-deck snapshots and conditional persistence.
- Return structured MCP-ready results and stable errors.
- Add server instructions derived from Ark authoring rules.
- Test every tool through the runner against a real temporary `.ark` workspace.

### Phase 4: stdio bridge and lifecycle

- Add `apps/mcp` and the official MCP server SDK.
- Register the v1 tools and forward calls to the internal runner.
- Add atomic runtime discovery, session capability rotation, and stale-record cleanup.
- Add the pre-single-instance `--mcp` entry path.
- Exit cleanly on stdin EOF and termination signals; keep stdout protocol-only.
- Test Ark stopped, MCP disabled, Ark restart, invalid capability, and simultaneous Codex/Claude
  bridge processes.

### Phase 5: product UI and settings

- Add the deck-toolbar entry and running indicator.
- Add the Settings integration section and autostart toggle.
- Expose status, start, stop, active-deck, commands, and update events through preload.
- Generate and copy platform-specific Codex and Claude Code commands.
- Show the shared deck title, connected client, last activity, and actionable errors.
- Cover keyboard access, focus handling, screen-reader labels, and reduced-motion behavior.

### Phase 6: packaging and end-to-end verification

- Ensure `Ark --mcp` works in macOS, Windows, AppImage, and deb artifacts.
- Verify code signing/notarization includes the bundled MCP code.
- Smoke-test connection, read, patch, conflict, live refresh, undo, stop/revoke, and clean bridge
  shutdown with both Codex and Claude Code.
- Document manual setup, verification, removal, troubleshooting, and privacy behavior.
- Run format, lint, typecheck, build, tests, desktop smoke, audit, and installer packaging checks.

## Acceptance criteria

The v1 feature is complete when:

- A user can start and stop MCP from an open deck.
- The autostart preference behaves consistently across restarts and defaults off.
- The UI generates working Codex and Claude Code commands for each packaged platform.
- Users do not install Node.js, npm, or a second Ark package.
- A configured client can connect after Ark restarts without changing its configuration.
- Read tools operate only on the visible deck.
- Every write uses Ark's existing validation and structured edit behavior.
- A successful external edit updates the live preview and thumbnails without reload.
- One MCP mutation creates one Ark session undo boundary.
- Concurrent UI or MCP edits produce a recoverable revision conflict, never silent overwrite.
- Invalid HTML does not change the document or revision.
- Stopping MCP immediately prevents subsequent external writes.
- Closing the client ends its bridge process, and quitting Ark leaves no MCP daemon.
- Capabilities and full deck HTML never appear in logs or the renderer-facing MCP status API.
- Existing built-in agent, manual editor, preview, and packaging tests remain green.

## Future extensions

After active-deck editing is stable, add these independently:

1. `list_decks` with metadata-only results and an explicit broader permission.
2. `open_deck` with user-visible UI navigation and confirmation.
3. `create_deck` using Ark's normal workspace-location behavior.
4. Attachment and asset tools scoped to the selected workspace.
5. Persistent revision history and rollback tools.
6. Optional one-click CLI setup/removal.
7. Streamable HTTP only if a real non-local or URL-based client requirement appears.

None of these should delay the first useful flow: start MCP, connect a local agent, and safely edit
the presentation currently open in Ark.
