# @ark/agent

**One job:** running a deck generation. One user message becomes one agent run: as many
model/tool steps as it takes, then a deck update and an assistant summary.

Layer 6 — the top of the package stack, below the apps. It speaks both the domain packages and
the wire (`@ark/contracts`), because a job runner is handed an HTTP request shape and returns an
HTTP response shape. Server-only. The public entry is `@ark/agent` (`index.ts`); deep imports
remain supported.

| Module            | Responsibility                                                        |
| ----------------- | --------------------------------------------------------------------- |
| `agent.ts`        | The multi-step loop: system prompt, tools, stop conditions, telemetry |
| `tools.ts`        | The tool implementations the model calls                              |
| `tool-schemas.ts` | Input schemas for those tools, shared with `@ark/mcp`                 |
| `tool-catalog.ts` | Binds tools to an active deck for one run                             |
| `workspace.ts`    | The agent's view of the deck it is editing                            |
| `document.ts`     | Reading deck HTML by line, byte, or slide — what `read_deck` returns  |
| `response.ts`     | Validating and shaping what the model produced                        |
| `guides.ts`       | Loads `agent-guides/*.md` into the system prompt                      |
| `prompt.ts`       | User-prompt wrapping (new-deck vs revise, selection/theme notes)      |
| `job-runner.ts`   | Job lifecycle: queue, schedule, start, cancel, retry                  |
| `job/`            | Generation job phases — claim, attachments, run, persist, fail        |
| `job-wire.ts`     | Maps a job to its REST shape                                          |

A generation job is a sequence of plain functions over a `JobContext` (`job/context.ts`):
claim the lease, resolve attachments, run the agent, persist the result, or record failure.
`createGenerationJobRunner` wires those phases, owns scheduling, and holds a
`JobControllerRegistry` (`job/controller-registry.ts`) instead of module-level abort state.
`startJob` and `retryJob` share request-building in `job/build-job.ts`.

`tool-schemas.ts` lives here rather than in `@ark/mcp` because the agent loop and the MCP server
expose the same deck tools; putting them in MCP made the two packages mutually dependent.
