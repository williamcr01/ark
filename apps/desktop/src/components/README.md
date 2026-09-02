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

## Thumbnail strip and element inspector

`thumbnail-strip/` owns the slide filmstrip. `SlideThumbnailStrip` is layout and composition only: it wires mount-window, srcDoc cache, drag-reorder, keyboard reorder, and scroll-sync hooks, then renders `SlideThumbnail` rows. Pure index math (mounted-window, drop-target, preview offset) lives in `lib/deck/thumbnail-strip.ts`. Import the strip from `components/SlideThumbnailStrip.tsx` — that path is the stable re-export.

`element-inspector/` owns the selected-element panel. `ElementInspector` composes one section per inspector group (identity, geometry, typography, image, layer, lock) plus shared `InspectorField` primitives. Parsing, formatting, and patch builders live in `lib/editor/element-inspector.ts`. Import the panel from `components/ElementInspector.tsx` — that path is the stable re-export.

Parents (`DeckPreview`, `SelectionInspectorChrome`) keep their current imports and props; these folders are an internal split only.
