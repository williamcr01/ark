# Deck preview orchestration

`DeckPreview` is the trusted composition boundary between the Ark shell and a
potentially hostile deck frame. Its extracted hooks own narrow state machines;
they do not authenticate messages or decide whether a frame load is trusted.

## Ownership

| Owner                           | Responsibility                                                                                                                                          | Must not own                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `DeckPreview`                   | iframe identity/ref, bridge-session gates, frame-load decision, navigation/editor activation                                                            | deck protocol parsing             |
| `useDeckPreviewSource`          | canonical versus rendered HTML, reload revision, live-patch begin/finish/rollback, deck reset                                                           | iframe loads or messages          |
| `useDeckEditorBridge`           | private editor port and authenticated editor events                                                                                                     | persistence authorization         |
| `useDeckEditorPatchCoordinator` | authenticated editor-event persistence, deduplication, transform baseline, pending-transform serialization, stable-ID mapping, slide/reselection intent | origin/handshake validation       |
| `useDeckEditorShellShortcuts`   | active window keyboard/paste subscriptions and cleanup                                                                                                  | bridge transport                  |
| view components                 | render explicit props                                                                                                                                   | iframe generation or bridge state |

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

Moving the iframe into a presentational child is intentionally out of scope.
The owner of `onFrameLoad` must synchronously call the bridge-session load gate
before navigation or editor synchronization. Public navigation messages and the
private editor `MessagePort` remain separate capabilities.

## Remaining `DeckPreview` boundary

After extraction, `DeckPreview` remains larger than a typical React component
because it is the single owner of the iframe ref and generation key, the
synchronous frame-load compromise gate, navigation activation, private editor
activation, Present-mode frame reuse, and viewport composition. Splitting those
across child mounts would obscure effect ordering and synchronous send gating.
The remaining size is therefore a reviewed trust boundary, not a target for a
line-count-only split. Display-only header and status overlays live in
`DeckPreviewHeader` and `DeckPreviewStatusOverlays`.
