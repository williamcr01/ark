# Desktop renderer components

## Title bar composition

`AppTitleBar` is a thin frame (`variant`, optional `navActive` / `onToggleChat` / dashboard `fileActions`). It does not take a 30-field props bag.

Editor chrome lives in `title-bar/EditorTitleBar.tsx` and reads `deck-store`, `shell-store`, `editor-store`, `chat-store`, plus `useWorkspaceFileActions`, `useDeckExport`, and `useDeckAnalysis`. Dashboard chrome lives in `title-bar/DashboardTitleBar.tsx` and uses `useDashboardFileActions`.

Pieces:

- `TitleBarFileMenu` — new/open/save-as/move/duplicate/share, and the home overflow menu
- `TitleBarDeckActions` — export PDF/PPTX, HTML download, present
- `TitleBarViewToggles` — slide strip and chat panel
- `TitleBarSettingsButton` — settings dialog and MCP indicator

Undo/redo and document restore stay in the editor toolbar (`DeckRestoreHistoryMenu`), not the window title bar.

## Deck preview composition

`DeckPreview` is a thin composition root. It reads deck/chat/editor Zustand stores and wires three layers:

- **Frame** (`DeckPreviewFrame` / `DeckPreviewStage`) owns the sandbox iframe, drop target, `useDeckPreviewFrame` / `usePreviewBridgeSession` load gating, and status overlays.
- **Editor layer** (`DeckEditorLayer`) owns the private editor `MessagePort` (`useEditorBridgePort` + `useEditorBridgeMessages`), patch coordination (`useEditorPatchQueue` + `useEditorDragCommit` + `useEditorRuntimePatches`), selection overlay, and inspector chrome.
- **Chrome** (`DeckPreviewChrome`) portals `EditModeToolbar` into the parent-owned `chromeHost` and hosts the hidden image file input.
- **Strip** (`DeckPreviewStrip`) owns thumbnail loading and `SlideThumbnailStrip`.

Empty decks render `EmptyPreview`. Slide navigation is store-backed (`useSlideIndex` + `useSlideNavigationSync`).

## Thumbnail strip and element inspector

`thumbnail-strip/` owns the slide filmstrip. `SlideThumbnailStrip` is layout and composition only: it wires mount-window, srcDoc cache, drag-reorder, keyboard reorder, and scroll-sync hooks, then renders `SlideThumbnail` rows. Pure index math (mounted-window, drop-target, preview offset) lives in `lib/deck/thumbnail-strip.ts`. Import the strip from `components/SlideThumbnailStrip.tsx` — that path is the stable re-export.

`element-inspector/` owns the selected-element panel. `ElementInspector` composes one section per inspector group (identity, geometry, typography, image, layer, lock) plus shared `InspectorField` primitives. Parsing, formatting, and patch builders live in `lib/editor/element-inspector.ts`. Import the panel from `components/ElementInspector.tsx` — that path is the stable re-export.

## Chat panel composition

`ChatPanel` is a thin layout shell. Call sites pass `layout` (`sidebar` | `home`) and an optional `contextSlot`. Everything else comes from zustand stores and chat hooks via `ChatPanelRuntimeProvider`.

```
ChatPanel
  ChatTranscript          message list, live steps, delivery status
  ChatInteractions        AgentQuestions / ThemePicker (in-panel)
  ChatGenerationStatus    presence, MCP waiting, error banners
  ChatQueuedSends         queued follow-ups
  ChatComposer            prompt, attachments, model + reasoning, submit/stop
```

`WorkspaceChatPanel` was removed; `EditorWorkspace` and `CreationWorkspace` render `ChatPanel` directly.
