# Renderer state

Zustand stores in this folder are the shared state layer for the desktop renderer.

## Stores vs hooks

- **Stores** hold domain state and synchronous reducers. Components and hooks subscribe with selectors (`useDeckStore((s) => s.html)`).
- **Hooks** under `src/hooks/` own async orchestration: API calls, job polling, bridge sessions, timers, and chat/job session side effects. They read and write stores.
- Workspace orchestration hooks (`useWorkspaceRuntime`, `useWorkspaceFileActions`, `useManualEditCommits`, `usePromptSubmit`, `useChatContextSlides`, `useExternalDeckUpdates`, `useChatPanelLayout`) live next to those session hooks. They may import stores, `@/lib/**`, and other hooks — never `@/components/*`. Shell components under `src/components/shell/` call them. `AppTitleBar` reads stores and those hooks itself; do not rebuild a large title-bar props object in the shell.

## Rules

- A store never performs async work (no fetch, no polling, no timers).
- A store never imports a React component, a hook, or another store's internals.
- User-preference persistence may live in a store action or initializer (keep existing storage keys). Chat, deck, and generation-job persistence stay in hooks.
- `resetAllStores()` resets every store. Vitest setup calls it between tests.
