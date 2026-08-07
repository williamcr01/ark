# MCP guides

Markdown files in this directory are returned by the read-only `get_authoring_guide` MCP tool.
They mirror `agent-guides/`, but must describe only tools and workflows available to external MCP
clients such as Claude Code and Codex.

## Convention

| Rule    | Behavior                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------- |
| Include | All `*.md` files directly in this directory (non-recursive)                                               |
| Order   | Lexicographic by filename; use numeric prefixes (`00-base-rules.md`, `10-reveal-js.md`, `20-chart-js.md`) |
| Exclude | This `README.md`, and files starting with `_`                                                             |
| Content | Plain markdown. Optional YAML frontmatter is stripped                                                     |

Do not duplicate the live approved-runtime URL list here. The MCP guide response generates it from
`runtimes/manifest.json` through `buildRuntimeRegistryPromptSection()`.

When an `agent-guides/` document changes, update its MCP copy too. Replace internal-only tools with
their MCP equivalent when one exists; otherwise describe the equivalent conversational workflow.

Packaged overrides:

- `ARK_MCP_GUIDES_DIR`: alternate directory
- `ARK_MCP_GUIDES_MAX_BYTES`: truncate concatenated guides past this size
