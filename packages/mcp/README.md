# @ark/mcp

**One job:** exposing Ark's deck tools to external agents over MCP, and routing their calls into
the deck the user is actually looking at.

Layer 7. Depends on `@ark/agent` for the tool implementations and schemas. Server-only.
`apps/mcp` (`@ark/mcp-server`) is the stdio executable that serves this over the wire.
The public entry is `@ark/mcp` (`index.ts`); deep imports remain supported.

| Module              | Responsibility                                               |
| ------------------- | ------------------------------------------------------------ |
| `tool-catalog.ts`   | The tool list and descriptions advertised to MCP clients     |
| `runner.ts`         | `createMcpRunner` — wires stores into one tool call          |
| `runner-execute.ts` | `executeMcpTool` against the active deck                     |
| `runner-shared.ts`  | Shared runner errors and helpers                             |
| `service.ts`        | Server lifecycle state (stopped / running / stopping)        |
| `interactions.ts`   | Pending questions and theme proposals awaiting a user answer |
| `guides.ts`         | The authoring guide served to external agents                |
| `discovery.ts`      | How an external agent finds the running Ark instance         |
