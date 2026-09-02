# Deck preview orchestration

`DeckPreview` is the trusted composition boundary between the Ark shell and a
potentially hostile deck frame. Its extracted hooks own narrow state machines;
they do not authenticate messages or decide whether a frame load is trusted.

## Ownership

| Owner                                                                     | Responsibility                                                                                                                                          | Must not own                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `DeckPreview`                                                             | Compose frame, editor layer, and chrome; thumbnail strip; present-mode exit                                                                             | deck protocol parsing             |
| `DeckPreviewFrame`                                                        | iframe identity/ref, bridge-session load gate, status overlays                                                                                          | persistence authorization         |
| `useDeckPreviewSource`                                                    | canonical versus rendered HTML, reload revision, live-patch begin/finish/rollback, deck reset                                                           | iframe loads or messages          |
| `useEditorBridgePort`                                                     | private editor port lifecycle, handshake, and shell commands                                                                                            | persistence authorization         |
| `useEditorBridgeMessages`                                                 | dispatch authenticated runtime messages into overlay state / editor-store                                                                               | origin/handshake validation       |
| `useEditorPatchQueue` / `useEditorDragCommit` / `useEditorRuntimePatches` | authenticated editor-event persistence, deduplication, transform baseline, pending-transform serialization, stable-ID mapping, slide/reselection intent | origin/handshake validation       |
| `useSlideIndex` / `useSlideNavigationSync`                                | store-backed slide index and public deck-bridge navigation sync                                                                                         | editor MessagePort                |
| `useDeckEditorShellShortcuts`                                             | active window keyboard/paste subscriptions and cleanup                                                                                                  | bridge transport                  |
| view components                                                           | render explicit props                                                                                                                                   | iframe generation or bridge state |

The server remains authoritative for every element patch. Selection metadata
from the client identifies an edit target; it never authorizes an operation.

## State transitions

| Event                                      | Synchronous ref/capability changes                                            | React state / follow-up                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Deck or canonical source changes           | Clear live-patch expectation on deck change                                   | Reset preview source and increment the reload revision                     |
| Iframe generation changes                  | Close the old editor port, clear queued messages, create a fresh session gate | Reset editor bridge state                                                  |
| Handshake pending → armed                  | `canPostToFrame` begins accepting only the current generation                 | Restore slide, then enable the editor when active                          |
| Armed → compromised                        | Reject sends and inbound traffic before any downstream load handling          | Tear down iframe, show warning, report once                                |
| Preview → Present                          | Keep the main frame; editor traffic becomes inactive                          | Resize shared stage and use presentation keyboard mode                     |
| Present → preview                          | Record final slide before closing                                             | Navigate the same frame to the recorded slide and re-enable editor traffic |
| Editor event → live patch → persisted HTML | Mark the live patch pending and record slide/reselection intent               | Keep the live DOM on success; reload canonical HTML on failure             |
| Persisted reload → reselection             | Ignore stale intent or a newer user selection                                 | Select only after a new iframe generation is editor-ready                  |

Refs are used where a gate must change in the same browser task (compromise,
generation identity, event deduplication, transform baselines, and pending
reselection). React state is used for renderable source, editor, and UI state.

## Security review boundary

The iframe lives in `DeckPreviewFrame`. The owner of `onFrameLoad` must
synchronously call the bridge-session load gate before navigation or editor
synchronization. Public navigation messages and the private editor `MessagePort`
remain separate capabilities.

## Remaining `DeckPreview` boundary

`DeckPreview` is the composition root for the preview stage. The sandbox iframe
lives in `DeckPreviewFrame` so it can call the bridge-session load gate
synchronously from `onLoad` before navigation or editor activation. Public
navigation messages and the private editor `MessagePort` remain separate
capabilities. Display-only status overlays live in `DeckPreviewStatusOverlays`.
