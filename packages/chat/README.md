# @ark/chat

**One job:** the conversation model — what a chat message, an agent step, a generation job, an
agent question, and a theme proposal _are_.

Layer 2. May import `@ark/runtime-registry`, `@ark/deck`, and `@ark/ai`. Browser-safe.

This is deliberately not part of `@ark/agent`. The renderer renders these shapes, `@ark/storage`
persists them, `@ark/contracts` puts them on the wire, and the agent runtime produces them — so the
model has to sit below all four. `@ark/agent` holds the loop that runs against it.

| Module               | Responsibility                                                        |
| -------------------- | --------------------------------------------------------------------- |
| `chat.ts`            | Barrel re-export of the conversation-model modules below              |
| `messages.ts`        | Message, part, and agent-step types; ids; persistence size limits     |
| `attachments.ts`     | Attachment shape, parse/decode helpers, asset-id collection           |
| `context.ts`         | Editor/slide/theme context types, normalisation, factual descriptions |
| `model-messages.ts`  | AI-SDK model-message conversion; optional injected user-prompt wrap   |
| `api-projection.ts`  | API payload messages, request parse, assistant-turn projections       |
| `chat-thread.ts`     | Grouping messages into a thread                                       |
| `chat-context.ts`    | Projecting a thread into model-facing context                         |
| `generation-job.ts`  | Job state, progress, provider call metrics                            |
| `agent-questions.ts` | The question-to-user protocol                                         |
| `agent-themes.ts`    | The theme-proposal protocol (candidates wrap `@ark/deck` theme specs) |
