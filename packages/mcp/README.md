# @ark/mcp

**One job:** exposing Ark's deck tools to external agents over MCP, and routing their calls into
the deck the user is actually looking at.

Layer 5. Depends on `@ark/agent` for the tool implementations and schemas. Server-only.
`apps/mcp` (`@ark/mcp-server`) is the stdio executable that serves this over the wire.

| Module            | Responsibility                                               |
| ----------------- | ------------------------------------------------------------ |
| `tool-catalog.ts` | The tool list and descriptions advertised to MCP clients     |
| `runner.ts`       | Executes one tool call against the active deck               |
| `service.ts`      | Server lifecycle state (stopped / running / stopping)        |
| `interactions.ts` | Pending questions and theme proposals awaiting a user answer |
| `guides.ts`       | The authoring guide served to external agents                |
| `discovery.ts`    | How an external agent finds the running Ark instance         |
