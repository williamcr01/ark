# Renderer state

Zustand stores in this folder are the shared state layer for the desktop renderer.

## Stores vs hooks

- **Stores** hold domain state and synchronous reducers. Components and hooks subscribe with selectors (`useDeckStore((s) => s.html)`).
- **Hooks** under `src/hooks/` own async orchestration: API calls, job polling, bridge sessions, timers, and chat/job session side effects. They read and write stores.
- Workspace orchestration hooks (`useWorkspaceRuntime`, `useWorkspaceFileActions`, `useManualEditCommits`, `usePromptSubmit`, `useChatContextSlides`, `useExternalDeckUpdates`, `useChatPanelLayout`) live next to those session hooks. They may import stores, `@/lib/**`, and other hooks — never `@/components/*`. Shell components under `src/components/shell/` call them for workspace chrome. `AppTitleBar` and `ChatPanel` read stores and those hooks themselves; do not rebuild large props objects for them in the shell.

## Chat panel composition

`ChatPanel` is a layout shell (`layout`, `contextSlot`). Transcript, composer, and generation status are not passed as props.

- `ChatPanelRuntimeProvider` (`components/chat/chat-panel-runtime.tsx`) wires `usePromptSubmit`, `useMcpInteraction`, appearance, and workspace runtime actions once.
- `ChatTranscript` renders the message list, live agent steps, and delivery status from `chat-store`.
- `ChatInteractions` hosts in-transcript `AgentQuestions` / `ThemePicker` (and MCP when the pending interaction is in-panel).
- `ChatGenerationStatus` shows presence, MCP waiting copy, and floating error/warning banners.
- `ChatQueuedSends` / `ChatComposer` own the send queue, prompt, attachments, and model/reasoning pickers.

Plain state (`messages`, `input`, `isGenerating`, job progress, queued sends) is selected from `chat-store`, `models-store`, and `shell-store`. Actions stay in `usePromptSubmit`, `useChatSession`, `useDeckGenerationFlow`, and `useMcpInteraction`.

## Rules

- A store never performs async work (no fetch, no polling, no timers).
- A store never imports a React component, a hook, or another store's internals.
- User-preference persistence may live in a store action or initializer (keep existing storage keys). Chat, deck, and generation-job persistence stay in hooks.
- `resetAllStores()` resets every store. Vitest setup calls it between tests.
