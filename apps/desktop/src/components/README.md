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
