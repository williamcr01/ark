# Desktop renderer components

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
