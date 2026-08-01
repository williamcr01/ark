# Ark manual editor bridge

Ark previews decks inside a sandboxed iframe (`sandbox="allow-scripts"`). The shell enables the editor runtime for CSS-only, approved Reveal, Reveal+Chart.js, and custom-JS decks whenever the preview is interactive (not presenting or generating) — there is no Preview/Edit toggle. The shell and injected editor runtime coordinate selection, geometry, transforms, and inline text editing through a private, per-preview `MessagePort` protocol defined in `packages/deck-core/deck-editor-bridge.ts`.

See [deck-preview-orchestration.md](./deck-preview-orchestration.md) for the
shell-side ownership and state-transition table. The private editor port stays
inside `useDeckEditorBridge`; extracted source and shortcut hooks cannot post
bridge messages or authorize persistence.

Authenticated editor events are persisted by
`useDeckEditorPatchCoordinator`. That hook owns event deduplication, transform
baselines, pending-transform serialization, stable-ID reselection, and
live-patch rollback, but receives events only after `useDeckEditorBridge` has
accepted them through the private port. Server-side element patch validation
remains authoritative.

This protocol is separate from, but co-injected with, the navigation bridge documented in [deck-bridge.md](./deck-bridge.md).

## Transport

| Direction    | Mechanism                                                  |
| ------------ | ---------------------------------------------------------- |
| Bootstrap    | Authenticated `window.postMessage` with a transferred port |
| Shell ↔ deck | Entangled `MessagePort` endpoints                          |

Protocol version: `EDITOR_BRIDGE_PROTOCOL_VERSION` (currently `1`).

All message types use the `ark:editor-*` prefix. TypeScript types, validators (`isEditor*Message`), and factory helpers (`createEditor*Message`) live in `packages/deck-core/deck-editor-bridge.ts`.

## Relationship to the navigation bridge

Preview HTML is built by `buildPreviewHtml` in `packages/deck-core/deck-preview-html.ts`. Ark always injects a **navigation** runtime (CSS shim, reveal adapter, or full-JS bridge). Interactive shell previews also inject the **editor** runtime up front (`editorBridge: true`); the shell activates or deactivates that dormant runtime with `ark:editor-enable` / `ark:editor-disable` messages instead of remounting the iframe.

Load order:

1. The per-session handshake sentinel runs as the first head script, hands its capability to the editor bootstrap, posts the navigation handshake, and removes its own script node.
2. The editor runtime runs next in `<head>`, consumes the capability, removes its own script node, and transfers one endpoint of a new `MessageChannel` to the shell.
3. Deck-authored scripts run normally.
4. The navigation runtime (`data-ark-preview-nav`, `data-ark-preview-reveal`, or `data-ark-preview-bridge`) handles the separate `ark:deck-*` protocol.

Interactive previews include the editor bootstrap; thumbnail renders omit it. Navigation continues to use its existing window-message protocol. Editor commands and results use only the transferred port after bootstrap.

## Lifecycle

### Enable / disable

| Step | Actor | Action                                                                                           |
| ---- | ----- | ------------------------------------------------------------------------------------------------ |
| 1    | Shell | Derives edit chrome from a loaded deck that is not presenting or generating (`DeckPreview`)      |
| 2    | Shell | The existing editor-capable preview frame stays mounted                                          |
| 3    | Shell | `useDeckEditorBridge` authenticates the bootstrap and acknowledges its transferred `MessagePort` |
| 4    | Shell | Sends `ark:editor-enable` over the port with the active slide index, tool, and preview scale     |
| 5    | Deck  | Activates its pre-bound pointer/keyboard listeners and sends `ark:editor-ready` over the port    |
| 6    | Shell | Marks `editorReady: true`; re-sends `ark:editor-enable` when the active slide changes            |

`ark:editor-ready` guarantees:

- The editor runtime received `ark:editor-enable`
- Pointer and keyboard listeners are active
- `slideIndex` in the ready message matches the editor's active slide
- `protocolVersion` is `1`

The shell posts `ark:editor-configure` when the preview scale changes. The runtime divides handle, guide, and hit-target sizes by this scale so editor chrome stays usable at any zoom.

The editor runtime is **dormant** until `ark:editor-enable`. Messages other than enable/disable are ignored while disabled.

**Disable:** the shell posts `ark:editor-disable` when Present mode opens, generation starts, or the deck becomes empty. The runtime ends any active text edit (without commit), clears selection/hover, makes its pre-bound listeners dormant, and posts `ark:editor-selection-change` with `selection: null`.

### Preview reloads and deck switches

- Each preview session or HTML change produces a new `iframeKey` / `iframeGenerationKey`. `useDeckEditorBridge` increments a generation counter and **ignores** runtime messages whose generation does not match — this rejects stale frames after reload.
- A new generation closes the old `MessagePort`; later traffic on it cannot reach the shell.
- When present mode is open, generation is running, or the deck has no slides, runtime messages are ignored and the editor is disabled.
- After a successful text commit, `DeckPreview` preserves the active slide index across the preview HTML refresh triggered by the patch response.

## Message reference

### Parent → iframe (shell messages)

| Type                          | Payload fields                                           | When sent                                                   | Receiver behavior                                                              |
| ----------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `ark:editor-enable`           | `slideIndex`, `tool?: EditorTool`, `scale?: number`      | Edit chrome active, iframe load, or active slide change     | Bind listeners; set slide index, tool, and scale; post `ark:editor-ready`      |
| `ark:editor-configure`        | `scale: number`                                          | Preview scale changes                                       | Resize editor chrome without re-enabling the runtime                           |
| `ark:editor-disable`          | _(none)_                                                 | Present mode, generation, or empty deck                     | Tear down editor state; clear selection                                        |
| `ark:editor-select`           | `elementId: string`, `slideIndex: number`                | Restore selection after a persisted patch and iframe reload | Resolve element; highlight; post `ark:editor-selection-change`                 |
| `ark:editor-clear-selection`  | _(none)_                                                 | Clear selection programmatically                            | Deselect; post `ark:editor-selection-change` with `null`                       |
| `ark:editor-start-text-edit`  | `elementId: string`, `slideIndex: number`                | **Edit text** button or Enter on a text-editable selection  | Enter `contenteditable` on element; post `ark:editor-text-edit-state`          |
| `ark:editor-cancel-text-edit` | _(none)_                                                 | Escape (shell) or cancel flow                               | Revert text; exit edit; post `ark:editor-text-edit-state` with `active: false` |
| `ark:editor-request-geometry` | `elementId: string`, `slideIndex: number`                | Selection changes while edit chrome is active               | Measure element; post `ark:editor-geometry`                                    |
| `ark:editor-set-tool`         | `tool: EditorTool`                                       | Toolbar tool selection                                      | Set active tool: `select`, `text`, or `insert`                                 |
| `ark:editor-transform-end`    | _(none)_                                                 | Parent shell observes `pointerup` outside the iframe        | Commit if the gesture started; otherwise clear without persisting              |
| `ark:editor-transform-cancel` | _(none)_                                                 | Parent shell observes `pointercancel`, or Escape            | Restore the pre-gesture inline style and clear transient transform chrome      |
| `ark:editor-assign-id`        | `fromElementId`, `toElementId`, `slideIndex`, `managed?` | After a successful live patch stamps a stable id            | Set `data-ark-id` (and optional `data-ark-managed`) on the live element        |

#### `EditorTool`

```ts
type EditorTool = 'select' | 'text' | 'insert'
```

- `select` — pointer-down selects editable elements (default).
- `text` — click-drag inserts Ark-managed text boxes (#79); click without drag inserts a default-size box.
- `insert` — reserved for generic insert flows (e.g. images).

### iframe → parent (runtime messages)

#### Selection

| Type                          | Payload fields                                                     | When fired                                                       | Parent behavior                                              |
| ----------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| `ark:editor-hover`            | `elementId`, `slideIndex`, `geometry?`, `slideBounds?`, `surface?` | Pointer move over the active slide (suppressed during text edit) | Draw hover chrome from the inline geometry                   |
| `ark:editor-selection-change` | `selection: EditorSelectionInfo \| null`                           | Click select/deselect, disable, or programmatic select           | Update selection; drive overlay and **Edit text** affordance |

```ts
type EditorSelectionInfo = {
  elementId: string
  slideIndex: number
  slideId: string | null // from data-ark-slide-id on the slide element
  tagName: string
  locked: boolean // data-ark-locked="true"
  managed: boolean // data-ark-managed="true" or Ark text box
  editableKind: string | null // data-ark-editable (e.g. "text-box", "image")
  textPreview: string | null // collapsed whitespace text or alt text
  imageFit?: 'contain' | 'cover' | 'fill' | null // images only
  surface?: 'light' | 'dark' // local background tone for adaptive chrome
  // Inspector metadata (issue #84).
  role?: string | null // data-ark-role
  textStyle?: {
    fontSize: number // computed px
    fontWeight: string // computed numeric string, e.g. "700"
    color: string // computed CSS color
    textAlign: string // computed alignment keyword
    lineHeight: number | null // computed px, null when "normal"
  } | null
  imageNaturalSize?: { width: number; height: number } | null // img intrinsic size
}
```

Selection candidates include text, images/SVG, links, and layout containers (`div`, non-slide `section`, lists, tables, blockquotes, `pre`, `figure`, and `hr`) with non-zero geometry. Hit-testing keeps the innermost candidate unless it belongs to a managed wrapper. Escape selects the next editable parent, then clears selection at the slide root.

#### Geometry

| Type                  | Payload fields                                                                                                    | When fired                                | Parent behavior                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------- |
| `ark:editor-geometry` | `elementId`, `slideIndex`, `geometry: EditorNormalizedRect`, `zIndex: number \| null`, `slideBounds?`, `surface?` | Response to `ark:editor-request-geometry` | Position `EditorSelectionOverlay` |

```ts
type EditorNormalizedRect = {
  x: number // 0–1, left edge relative to slide box
  y: number // 0–1, top edge relative to slide box
  width: number // 0–1, fraction of slide width
  height: number // 0–1, fraction of slide height
}
```

Coordinates in `geometry` are **slide-relative normalized fractions** (0–1), derived from `getBoundingClientRect()` of the element and its containing slide. They are not document pixels. Transform commits also carry optional normalized CSS offsets and the slide's actual logical width/height, so plain and Reveal decks round-trip in their native coordinate space.

Optional `slideBounds` is the **slide box normalized to the iframe viewport** (`document.documentElement`). The shell composes `slideBounds` with slide-relative `geometry` when drawing `EditorSelectionOverlay` and the inspector settings trigger, so letterboxed or scaled slides (e.g. Reveal) stay aligned with the parent chrome. When omitted, the shell treats the slide as filling the stage (`{ x: 0, y: 0, width: 1, height: 1 }`). Transform preview/commit messages carry the same optional field for live drag chrome. `surface` is detected from the nearest composited background color or a gradient-stop average; the shell uses white chrome on dark surfaces and black chrome on light surfaces.

#### Text editing

Clicking selected text again without moving the pointer enters inline editing. A click-drag still moves the selected element; double-click, the **Edit text** button, and Enter remain supported.

| Type                         | Payload fields                                                        | When fired                                                                  | Parent behavior                                                     |
| ---------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `ark:editor-text-edit-state` | `active: boolean`; when `active: true` also `elementId`, `slideIndex` | Text edit starts or ends                                                    | Toggle `textEditActive`; overlay shows editing state                |
| `ark:editor-text-commit`     | `elementId`, `slideIndex`, `slideId`, `text`, `originalText`          | Focus leaves the `contenteditable` element (commit) or explicit commit path | Persist if text changed (see [Persistence path](#persistence-path)) |

**No-change detection:** `DeckPreview` skips persistence when `text === originalText`. The runtime captures `originalText` when editing starts (`textContent` at entry) and sends both values on commit.

**Locked elements:** the runtime rejects `ark:editor-start-text-edit` on locked elements with `ark:editor-error` (`code: locked-element`). The shell also hides the **Edit text** button when `selection.locked` is true.

**Supported tags** for inline text edit (runtime and shell): `h1`–`h6`, `p`, `li`, `blockquote`, `figcaption`, `span` (`INLINE_TEXT_EDITABLE_TAGS` in `packages/deck-core/deck-editable.ts`). Plain text only — nested markup inside the element is flattened to `textContent` on save.

#### Transforms

| Type                           | Payload fields                                                                                                        | When fired                | Semantics                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `ark:editor-transform-preview` | `elementId`, `slideIndex`, `geometry`, `zIndex?`, `slideBounds?`                                                      | During drag/resize/nudge  | **Uncommitted** visual update; parent may mirror in chrome but must not persist     |
| `ark:editor-transform-commit`  | Preview fields plus `adopted?`, `cssX?`, `cssY?`, `cssWidth?`, `cssHeight?`, `slideWidth?`, `slideHeight?`, `spacer?` | Gesture or nudge complete | **Persistence trigger**; parent maps to `move_element` / `resize_element` patch ops |
| `ark:editor-transform-cancel`  | _(none)_                                                                                                              | Gesture canceled          | Clear uncommitted preview state                                                     |

Dragging or resizing any unlocked selection adopts non-absolute content by preserving its parent, freezing its measured width, and switching it to absolute positioning in the same containing-block coordinate system. On first adoption the runtime inserts an inert `data-ark-spacer` sibling that reproduces the element's flow footprint (border-box size, margins, and display) so siblings and Reveal's scrollHeight-based centering do not shift; cancel paths remove that spacer, and adopted commits carry the footprint as `spacer` for the server to persist the same placeholder. Move gestures preview with a compositor `transform` and defer adoption until commit so siblings do not reflow mid-drag; resize still adopts once the drag threshold is crossed. Existing absolute descendants use that same coordinate conversion. Commits include logical slide dimensions so Reveal's native canvas size is preserved. Spacers are excluded from selection, hover, snapping, and patch targets.

Move gestures snap to slide and nearby element edges/centers; Alt disables snapping. Shift constrains move axes and preserves aspect ratio on corner resize. Escape restores the pre-gesture inline styles. Arrow keys nudge by one logical pixel (Shift: ten) and debounce into one commit. Pointer capture plus parent-window `ark:editor-transform-end` commits a gesture released outside the iframe; `lostpointercapture` after a started gesture also commits (sandbox frame edges can drop capture); only `pointercancel` and Escape cancel. After a successful live patch that stamps a new stable id, the shell posts `ark:editor-assign-id` so the live DOM matches server HTML without an iframe reload.

`useDeckEditorBridge` stores preview and commit messages separately; a preview clears any pending commit and vice versa. The shell serializes manual mutations, records undo/redo snapshots, and restores the stable element ID returned by the patch response after the iframe reloads.

Inspector geometry fields stay disabled when the runtime reports a nested containing block or a non-reference logical canvas; drag/resize remains available because the runtime owns those coordinate conversions.

#### Shortcuts

| Type                  | Payload fields                            | When fired                           | Parent behavior                    |
| --------------------- | ----------------------------------------- | ------------------------------------ | ---------------------------------- |
| `ark:editor-shortcut` | `action: 'undo' \| 'redo' \| 'duplicate'` | Cmd/Ctrl+Z, Shift+Z/Y, or Cmd/Ctrl+D | Run the corresponding shell action |

Undo during an uncommitted nudge cancels the local nudge and sends neither a transform commit nor an undo request. Other mutating actions are serialized after pending transforms.

#### Deletion and errors

| Type                        | Payload fields                               | When fired                                                       | Semantics                                                               |
| --------------------------- | -------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `ark:editor-delete-request` | `elementId`, `slideIndex`                    | User deletes an unlocked selection (Delete/Backspace or toolbar) | Parent should map to `delete_element` patch op after server validation  |
| `ark:editor-insert-request` | `kind: 'text-box'`, `slideIndex`, `geometry` | Text tool draw completes                                         | Parent should map to `insert_element` with `buildTextBoxHtml(geometry)` |
| `ark:editor-error`          | `message: string`, `code?: string`           | Runtime failure (missing element, locked, etc.)                  | Surface in preview chrome; optional `onEditorError` callback            |

Known error codes from the injected runtime: `locked-element`, `non-text-element`, `missing-element`, `missing-slide`, `editor-runtime`.

#### Ready

| Type               | Payload fields                             | When fired                                |
| ------------------ | ------------------------------------------ | ----------------------------------------- |
| `ark:editor-ready` | `slideIndex: number`, `protocolVersion: 1` | After `ark:editor-enable` completes setup |

## Security model

Cross-origin `postMessage` between the app shell and sandbox preview is a trust boundary. The editor bridge assumes **all iframe content is hostile**; the parent must never persist edits without server-side validation.

### Channel bootstrap

The only editor message accepted from the iframe's public window channel is `ark:editor-connect`. The shell requires all of:

- `event.source === iframe.contentWindow`
- `isAllowedBridgeMessageOrigin(event.origin, sandboxOrigin)`
- the current `iframeGenerationKey`
- the exact per-session handshake
- the current editor protocol version
- one transferred `MessagePort`

The handshake and editor scripts execute before deck-authored scripts, retain the handshake only in closures, and remove their script nodes before deck code runs. The runtime retries with fresh channel candidates until the shell acknowledges one. Both sides close old ports on generation changes.

After acknowledgement, the shell ignores public `ark:editor-*` runtime payloads and the runtime ignores public shell commands. A deck script can create its own `MessageChannel`, but it cannot supply the session capability or acquire the already-transferred endpoint.

### Stale-frame and forged messages

- **Capability channel:** routine editor traffic is accepted only on the authenticated per-preview port.
- **Generation guard:** `useDeckEditorBridge` tags each iframe load with `iframeGenerationKey`, closes the prior port, and drops stale messages.
- **Source/origin guards:** public bootstrap messages not originating from the current preview `contentWindow` and configured sandbox origin are dropped.
- **Shape guard:** only payloads passing `isEditorRuntimeMessage` / `isEditorShellMessage` are handled; unknown `ark:editor-*` types are ignored.
- **Authoritative patch guard:** the API resolves targets against persisted source HTML and rechecks editable metadata, unsafe tags, locks, allowed attributes/styles, and numeric bounds.
- **Hostile fixtures (#81):** security tests assert that forged public commits cannot enter the private channel or mutate shell state.

The editor and deck still share a DOM and JavaScript realm: arbitrary deck code can intentionally change rendered DOM, consume input, or otherwise interfere with the editing experience. Ordinary cross-browser pages do not have the extension-only isolated-world API that would provide separate globals while sharing one DOM. The private port prevents direct protocol forgery; sandbox/CSP containment and server-side validation remain the protection against untrusted deck behavior.

### Element identity

| Mechanism                          | Description                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `data-ark-id`                      | Stable element id assigned by Ark (#74 stamping) or ensured on first patch (`ensureStableElementId`)                                    |
| `transient-el-{slideIndex}-{path}` | Fallback id from child-index path under the slide when no `data-ark-id` exists (e.g. uploaded decks)                                    |
| `data-ark-slide-id`                | Optional stable slide id; included in commit payloads for disambiguation                                                                |
| Duplicate ids                      | `findElementByStableId` returns the first match in slide DOM order; patches with ambiguous cross-slide targets are rejected server-side |
| Missing ids                        | Transient path ids are resolved by walking `slide.children` indices; unresolvable ids produce `ark:editor-error` (`missing-element`)    |

### Managed vs locked semantics

Parsed by `apps/api/deck-editable-elements.ts` and enforced again in `apps/api/deck-element-patch.ts` on every patch:

| State                                                                                                                             | Meaning                                            | Editor behavior                                                                  | Patch behavior                                        |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Locked** (`data-ark-locked="true"` or derived lock reason)                                                                      | Selectable for inspection; not editable or movable | Shown with **Locked** badge; all mutation controls disabled                      | All mutating ops rejected                             |
| **Managed** (`data-ark-managed="true"`, or `data-ark-editable="true"` with `data-ark-id`, or absolutely positioned with top/left) | Already owned by Ark's manual layout system        | Move, resize, duplicate, delete, reorder, and inspect                            | Mutations allowed after normal target validation      |
| **Unmanaged deck content**                                                                                                        | Recognized deck-authored element not yet adopted   | Unlocked non-geometry controls; first canvas move adopts and assigns a stable id | Mutations allowed; patched targets receive stable ids |

Lock reasons include `explicit-lock`, `unsafe-tag`, `runtime-control`, `speaker-notes`, `hidden`, and `no-text-content`. `managed` is metadata, not a permission gate.

Keyboard **Delete/Backspace** and non-layout controls operate on any unlocked recognized selection. Inspector geometry and layer controls remain disabled until canvas movement adopts the element, because only the runtime knows its measured size and containing-block coordinates. The server still rejects locked, unsafe, unrecognized, and ambiguous targets.

Style edits and flow-positioned duplicates retain unmanaged flow layout; only an operation that establishes absolute layout stamps `data-ark-managed="true"`.

`reorder_element` accepts either an absolute `zIndex` or a `direction` (`'front'` / `'back'`). The manual editor sends `direction`; the server resolves it against the sibling z-index range (top sibling + 1 for front, floored at 0 for back) so layering is predictable even when siblings use the default `auto`/`0` level. Layer controls remain disabled until canvas movement adopts an element; the server rejects static targets rather than changing their layout to activate z-index.

### What the parent must not trust

- Commit text, geometry, or delete requests are **hints**. The shell forwards them to `POST /api/decks/:id/patch`, where `assertElementPatchable` re-validates parsed editable metadata, unsafe tags, and locks.
- Never apply iframe-reported HTML directly to deck state without a successful patch response.
- Never skip origin/source/generation checks when adding new handlers.

## Persistence path

End-to-end trace for an inline text edit:

```
User edits text in contenteditable (iframe)
  → focusout → runtime posts ark:editor-text-commit
  → useDeckEditorBridge sets lastTextCommit
  → DeckPreview effect: skip if text === originalText
  → onCommitTextEdit (App.handleCommitTextEdit)
  → patchDeckOperations([{ op: 'replace_text', elementId, slideIndex, slideId?, text }])
  → POST /api/decks/:id/patch
  → apps/api/deck-element-patch.ts: resolve element, assertElementPatchable, apply text
  → new deck version persisted; response includes updated HTML
  → useDeckPersistence.applyPatchedDeck updates shell html state
  → preview refreshes; preserveSlideIndexRef restores slide index
```

### Failure and rollback

If `patchDeckOperations` throws (network error, validation failure, locked element, etc.):

1. `App` shows a toast with the error message.
2. `refreshActiveDeck()` re-fetches the last persisted deck from the API, discarding optimistic iframe edits.
3. `DeckPreview` clears the processed-commit guard so a retry is possible.

While saving, `isPatching` drives the **Saving edit** indicator in the preview chrome.

Transforms, inserts, duplicates, deletes, inspector changes, and layer changes follow the same validated patch path. Manual mutations are queued per active deck session so concurrent gestures cannot overwrite each other or leak a stale response across a deck switch.

## Shell integration

| Component / module                                     | Role                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `apps/web/src/components/DeckPreview.tsx`              | Always-on edit chrome, text commit orchestration, overlay, keyboard shortcuts |
| `apps/web/src/hooks/useDeckEditorBridge.ts`            | Authenticated port bootstrap, runtime listener, and shell command helpers     |
| `apps/web/src/hooks/useDeckPersistence.ts`             | `patchDeckOperations`, `refreshActiveDeck`                                    |
| `apps/web/src/App.tsx`                                 | `handleCommitTextEdit` → `replace_text` patch                                 |
| `apps/web/src/components/EditorSelectionOverlay.tsx`   | Selection box from normalized geometry                                        |
| `apps/web/src/components/SelectionInspectorChrome.tsx` | Selection-anchored settings button + floating inspector panel                 |
| `apps/web/src/lib/deck-text-edit.ts`                   | `isTextEditableSelection` guard for inline text                               |
| `packages/deck-core/deck-preview-html.ts`              | Injects editor runtime when `editorBridge: true`                              |
| `apps/api/deck-element-patch.ts`                       | Server-side patch application and validation                                  |
| `apps/api/deck-editable-elements.ts`                   | Editable metadata parsing (#74)                                               |

Preview sessions record `editorBridge` so the sandbox host serves HTML with the editor script only when requested (`POST /api/preview-sessions` with `editorBridge: true`).

## Extension guidance

To add a new `ark:editor-*` message safely:

1. **Type union** — Add the constant, payload interface, and entry in `EDITOR_SHELL_MESSAGE_TYPES` or `EDITOR_RUNTIME_MESSAGE_TYPES` in `packages/deck-core/deck-editor-bridge.ts`.
2. **Validator** — Implement `isEditorFooMessage` with strict field checks; register it in `isEditorShellMessage` or `isEditorRuntimeMessage`.
3. **Factory** — Add `createEditorFooMessage` for tests and shell callers.
4. **Runtime handler** — Update `buildDeckEditorBridgeRuntimeScript` to emit or consume the message on the established port.
5. **Hook handler** — Handle the message in `useDeckEditorBridge` (or a dedicated hook) with port and generation guards.
6. **Persistence** — Map commit-style messages to `DeckPatchOperation` types in `packages/deck-core/deck-patch.ts` and `apps/api/deck-element-patch.ts`; never write deck HTML from the client alone.
7. **Tests** — Add validator tests in `packages/deck-core/deck-editor-bridge.test.ts`; add hook/integration tests in `apps/web/src/hooks/useDeckEditorBridge.test.tsx`. For security-sensitive messages, add hostile fixtures per #81 that assert rejected origins, sources, and malformed payloads have no side effects.

Update this document in the same PR as any protocol change.

## Related docs

- [deck-bridge.md](./deck-bridge.md) — navigation `ark:deck-*` protocol
- [reveal-runtime.md](./reveal-runtime.md) — reveal.js preview and slide index model
- [AGENTS.md](../AGENTS.md) — product overview and preview security defaults
