# @ark/chat

**One job:** the conversation model — what a chat message, an agent step, a generation job, an
agent question, and a theme proposal _are_.

Layer 2. May import `@ark/deck` and `@ark/ai`. Browser-safe.

This is deliberately not part of `@ark/agent`. The renderer renders these shapes, `@ark/storage`
persists them, `@ark/contracts` puts them on the wire, and the agent runtime produces them — so the
model has to sit below all four. `@ark/agent` holds the loop that runs against it.

| Module               | Responsibility                                                   |
| -------------------- | ---------------------------------------------------------------- |
| `chat.ts`            | Messages, parts, attachments, agent steps, tool-call projections |
| `chat-thread.ts`     | Grouping messages into a thread                                  |
| `chat-context.ts`    | Projecting a thread into model-facing context                    |
| `generation-job.ts`  | Job state, progress, provider call metrics                       |
| `agent-questions.ts` | The question-to-user protocol                                    |
| `agent-themes.ts`    | The theme-proposal protocol                                      |
