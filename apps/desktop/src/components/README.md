# Desktop renderer components

`DeckPreview` is a thin composition root. It reads deck/chat/editor Zustand stores and wires three layers:

- **Frame** (`DeckPreviewFrame` / `DeckPreviewStage`) owns the sandbox iframe, drop target, `useDeckPreviewFrame` / `usePreviewBridgeSession` load gating, and status overlays.
- **Editor layer** (`DeckEditorLayer`) owns the private editor `MessagePort` (`useEditorBridgePort` + `useEditorBridgeMessages`), patch coordination (`useEditorPatchQueue` + `useEditorDragCommit` + `useEditorRuntimePatches`), selection overlay, and inspector chrome.
- **Chrome** (`DeckPreviewChrome`) portals `EditModeToolbar` into the parent-owned `chromeHost` and hosts the hidden image file input.
- **Strip** (`DeckPreviewStrip`) owns thumbnail loading and `SlideThumbnailStrip`.

Empty decks render `EmptyPreview`. Slide navigation is store-backed (`useSlideIndex` + `useSlideNavigationSync`).
