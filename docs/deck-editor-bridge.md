# Ark manual editor bridge

Ark previews decks inside a sandboxed iframe (`sandbox="allow-scripts"`). For CSS-only and approved Reveal decks, the shell enables the editor runtime automatically whenever the deck is interactive (not presenting or generating) — there is no Preview/Edit toggle. Persistent manual editing is disabled for custom-JS decks because deck-authored scripts share the iframe execution realm and could forge editor messages. The shell and deck runtime coordinate selection, geometry, transforms, and inline text editing through a versioned `postMessage` protocol defined in `packages/deck-core/deck-editor-bridge.ts`.

This protocol is separate from, but co-injected with, the navigation bridge documented in [deck-bridge.md](./deck-bridge.md).

## Transport

| Direction    | Mechanism                                                             |
| ------------ | --------------------------------------------------------------------- |
| Shell → deck | `window.postMessage` to the preview iframe (`postEditorShellMessage`) |
| Deck → shell | `window.parent.postMessage` from the injected editor runtime          |

Protocol version: `EDITOR_BRIDGE_PROTOCOL_VERSION` (currently `1`).

All message types use the `ark:editor-*` prefix. TypeScript types, validators (`isEditor*Message`), and factory helpers (`createEditor*Message`) live in `packages/deck-core/deck-editor-bridge.ts`.

## Relationship to the navigation bridge

Preview HTML is built by `buildPreviewHtml` in `packages/deck-core/deck-preview-html.ts`. Ark always injects a **navigation** runtime (CSS shim, reveal adapter, or full-JS bridge). Interactive shell previews also inject the **editor** runtime up front (`editorBridge: true`); the shell activates or deactivates that dormant runtime with `ark:editor-enable` / `ark:editor-disable` messages instead of remounting the iframe.

Load order (before `</body>`):

1. Navigation runtime (`data-ark-preview-nav`, `data-ark-preview-reveal`, or `data-ark-preview-bridge`)
2. Editor runtime (`data-ark-preview-editor`) — present in interactive previews, omitted from thumbnail renders

Both runtimes are independent IIFEs. Navigation continues to handle `ark:deck-*` messages; the editor runtime handles `ark:editor-*` messages. They share slide selectors (`SLIDE_SELECTOR_CHAIN`) and the configured parent app origin.

## Lifecycle

### Enable / disable

| Step | Actor | Action                                                                                                  |
| ---- | ----- | ------------------------------------------------------------------------------------------------------- |
| 1    | Shell | Derives edit chrome from a loaded deck that is not presenting or generating (`DeckPreview`)             |
| 2    | Shell | The existing editor-capable preview frame stays mounted                                                 |
| 3    | Shell | `useDeckEditorBridge` attaches a `message` listener and calls `enableEditor(slideIndex, tool?, scale?)` |
| 4    | Shell | Posts `ark:editor-enable` with the active slide index, tool, and preview scale                          |
| 5    | Deck  | Binds pointer/keyboard listeners, sets `enabled = true`, posts `ark:editor-ready`                       |
| 6    | Shell | Marks `editorReady: true`; re-sends `ark:editor-enable` when the active slide changes                   |

`ark:editor-ready` guarantees:

- The editor runtime received `ark:editor-enable`
- Pointer and keyboard listeners are bound
- `slideIndex` in the ready message matches the editor's active slide
- `protocolVersion` is `1`

The shell posts `ark:editor-configure` when the preview scale changes. The runtime divides handle, guide, and hit-target sizes by this scale so editor chrome stays usable at any zoom.

The editor runtime is **dormant** until `ark:editor-enable`. Messages other than enable/disable are ignored while disabled.

**Disable:** the shell posts `ark:editor-disable` when Present mode opens, generation starts, or the deck becomes empty. The runtime ends any active text edit (without commit), clears selection/hover, unbinds listeners, and posts `ark:editor-selection-change` with `selection: null`.

### Preview reloads and deck switches

- Each preview session or HTML change produces a new `iframeKey` / `iframeGenerationKey`. `useDeckEditorBridge` increments a generation counter and **ignores** runtime messages whose generation does not match — this rejects stale frames after reload.
- Incoming messages are also rejected unless `event.source === iframeRef.contentWindow`.
- When present mode is open, generation is running, or the deck has no slides, the bridge hook is disabled and does not listen.
- After a successful text commit, `DeckPreview` preserves the active slide index across the preview HTML refresh triggered by the patch response.

## Message reference

### Parent → iframe (shell messages)

| Type                          | Payload fields                                      | When sent                                                   | Receiver behavior                                                              |
| ----------------------------- | --------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `ark:editor-enable`           | `slideIndex`, `tool?: EditorTool`, `scale?: number` | Edit chrome active, iframe load, or active slide change     | Bind listeners; set slide index, tool, and scale; post `ark:editor-ready`      |
| `ark:editor-configure`        | `scale: number`                                     | Preview scale changes                                       | Resize editor chrome without re-enabling the runtime                           |
| `ark:editor-disable`          | _(none)_                                            | Present mode, generation, or empty deck                     | Tear down editor state; clear selection                                        |
| `ark:editor-select`           | `elementId: string`, `slideIndex: number`           | Restore selection after a persisted patch and iframe reload | Resolve element; highlight; post `ark:editor-selection-change`                 |
| `ark:editor-clear-selection`  | _(none)_                                            | Clear selection programmatically                            | Deselect; post `ark:editor-selection-change` with `null`                       |
| `ark:editor-start-text-edit`  | `elementId: string`, `slideIndex: number`           | **Edit text** button or Enter on a text-editable selection  | Enter `contenteditable` on element; post `ark:editor-text-edit-state`          |
| `ark:editor-cancel-text-edit` | _(none)_                                            | Escape (shell) or cancel flow                               | Revert text; exit edit; post `ark:editor-text-edit-state` with `active: false` |
| `ark:editor-request-geometry` | `elementId: string`, `slideIndex: number`           | Selection changes while edit chrome is active               | Measure element; post `ark:editor-geometry`                                    |
| `ark:editor-set-tool`         | `tool: EditorTool`                                  | Toolbar tool selection                                      | Set active tool: `select`, `text`, or `insert`                                 |
| `ark:editor-transform-cancel` | _(none)_                                            | Pointer release/cancel is observed by the parent shell      | Restore the pre-gesture inline style and clear transient transform chrome      |

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
  // Inspector metadata (issue #84); optional for protocol compatibility.
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

| Type                         | Payload fields                                                        | When fired                                                                  | Parent behavior                                                     |
| ---------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `ark:editor-text-edit-state` | `active: boolean`; when `active: true` also `elementId`, `slideIndex` | Text edit starts or ends                                                    | Toggle `textEditActive`; overlay shows editing state                |
| `ark:editor-text-commit`     | `elementId`, `slideIndex`, `slideId`, `text`, `originalText`          | Focus leaves the `contenteditable` element (commit) or explicit commit path | Persist if text changed (see [Persistence path](#persistence-path)) |

**No-change detection:** `DeckPreview` skips persistence when `text === originalText`. The runtime captures `originalText` when editing starts (`textContent` at entry) and sends both values on commit.

**Locked elements:** the runtime rejects `ark:editor-start-text-edit` on locked elements with `ark:editor-error` (`code: locked-element`). The shell also hides the **Edit text** button when `selection.locked` is true.

**Supported tags** for inline text edit (runtime and shell): `h1`–`h6`, `p`, `li`, `blockquote`, `figcaption`, `span` (`INLINE_TEXT_EDITABLE_TAGS` in `packages/deck-core/deck-editable.ts`). Plain text only — nested markup inside the element is flattened to `textContent` on save.

#### Transforms

| Type                           | Payload fields                                                                                             | When fired                | Semantics                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `ark:editor-transform-preview` | `elementId`, `slideIndex`, `geometry`, `zIndex?`, `slideBounds?`                                           | During drag/resize/nudge  | **Uncommitted** visual update; parent may mirror in chrome but must not persist     |
| `ark:editor-transform-commit`  | Preview fields plus `adopted?`, `cssX?`, `cssY?`, `cssWidth?`, `cssHeight?`, `slideWidth?`, `slideHeight?` | Gesture or nudge complete | **Persistence trigger**; parent maps to `move_element` / `resize_element` patch ops |
| `ark:editor-transform-cancel`  | _(none)_                                                                                                   | Gesture canceled          | Clear uncommitted preview state                                                     |

Dragging any unlocked selection moves it. A non-absolute element is adopted on first move by preserving its parent, freezing its measured width, and switching it to absolute positioning in the same containing-block coordinate system. Existing absolute descendants use that same coordinate conversion. Commits include logical slide dimensions so Reveal's native canvas size is preserved.

Move gestures snap to slide and nearby element edges/centers; Alt disables snapping. Shift constrains move axes and preserves aspect ratio on corner resize. Escape restores the pre-gesture inline styles. Arrow keys nudge by one logical pixel (Shift: ten) and debounce into one commit. Pointer capture plus parent-window cancellation prevents a released-outside gesture from remaining active.

`useDeckEditorBridge` stores preview and commit messages separately; a preview clears any pending commit and vice versa. The shell serializes manual mutations, records undo/redo snapshots, and restores the stable element ID returned by the patch response after the iframe reloads.

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

### Origin scoping

| Direction    | Validation                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deck → shell | `event.source === iframe.contentWindow` **and** `isAllowedBridgeMessageOrigin(event.origin, sandboxOrigin)` (accepts configured sandbox origin or opaque `"null"`) |
| Shell → deck | Runtime accepts only `event.source === window.parent` **and** `event.origin === PARENT_ORIGIN` (app origin from the sandbox render URL `?parent=` query parameter) |

Parent → iframe posts use `postEditorShellMessage`, which targets `getDeckBridgeTargetOrigin(parentOrigin)` (configured app origin, or `*` as fallback). Navigation `ark:deck-goto` messages use `DECK_BRIDGE_POST_MESSAGE_TARGET` (`*`) explicitly so they reach opaque-origin sandbox frames — see [deck-bridge.md](./deck-bridge.md#security-notes).

Iframe → parent posts use `PARENT_ORIGIN` (embedded in the injected script) or `*` when unset.

### Stale-frame and forged messages

- **Generation guard:** `useDeckEditorBridge` tags each iframe load with `iframeGenerationKey`; runtime messages from a previous generation are dropped.
- **Source guard:** messages not originating from the current preview `contentWindow` are dropped.
- **Shape guard:** only payloads passing `isEditorRuntimeMessage` / `isEditorShellMessage` are handled; unknown `ark:editor-*` types are ignored.
- **Execution-realm guard:** custom-JS decks never activate the persistent editor bridge; a nonce cannot distinguish deck code from injected runtime code in the same window.
- **Hostile fixtures (#81):** security tests should assert that forged origins, wrong `event.source`, malformed payloads, and out-of-protocol types never mutate shell state or reach the patch API.

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

Keyboard **Delete/Backspace**, the toolbar, and non-geometry inspector controls operate on any unlocked recognized selection. Inspector geometry fields remain disabled until canvas movement adopts the element, because only the runtime knows its measured size and containing-block coordinates. The server still rejects locked, unsafe, unrecognized, and ambiguous targets.

`reorder_element` accepts either an absolute `zIndex` or a `direction` (`'front'` / `'back'`). The manual editor sends `direction`; the server resolves it against the sibling z-index range (top sibling + 1 for front, floored at 0 for back) so layering is predictable even when the element and its siblings sit at the default `auto`/`0` level.

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
| `apps/web/src/hooks/useDeckEditorBridge.ts`            | `postMessage` listener and shell command helpers                              |
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
4. **Runtime handler** — Update `buildDeckEditorBridgeRuntimeScript` to emit or consume the message; keep handlers inside the existing `message` listener with origin/source checks.
5. **Hook handler** — Handle the message in `useDeckEditorBridge` (or a dedicated hook) with generation, source, and origin guards.
6. **Persistence** — Map commit-style messages to `DeckPatchOperation` types in `packages/deck-core/deck-patch.ts` and `apps/api/deck-element-patch.ts`; never write deck HTML from the client alone.
7. **Tests** — Add validator tests in `packages/deck-core/deck-editor-bridge.test.ts`; add hook/integration tests in `apps/web/src/hooks/useDeckEditorBridge.test.tsx`. For security-sensitive messages, add hostile fixtures per #81 that assert rejected origins, sources, and malformed payloads have no side effects.

Update this document in the same PR as any protocol change.

## Related docs

- [deck-bridge.md](./deck-bridge.md) — navigation `ark:deck-*` protocol
- [reveal-runtime.md](./reveal-runtime.md) — reveal.js preview and slide index model
- [AGENTS.md](../AGENTS.md) — product overview and preview security defaults
