# Local MCP integration

Ark can let Codex, Claude Code, Grok, Cursor, OpenCode, or Devin CLI edit the presentation
currently visible in the desktop app. The integration is off by default, works through the
installed Ark executable, and does not require Node.js or an Ark API key.

**Devin** here is the local Devin CLI only, not Devin Cloud.

## Set up a client

1. Open the presentation you want to share in Ark.
2. Select the cable button in the deck toolbar, or open **Settings → External agents (MCP)** and
   select **Start MCP server**.
3. In the client list, select **Add** for Codex, Claude Code, Grok, Cursor, OpenCode, or Devin CLI.
   Ark writes that client's config only when you click; opening Settings does not change anything.
4. In the client, ask it to call `get_active_deck` before reading or editing the deck.

Before the first Ark edit in a conversation, the client receives instructions to load Ark's
MCP-specific authoring guide once. The guide supplies the deck structure, design, and approved
runtime rules used by Ark's built-in agent without referring to internal-only tools.

Each row shows **Not installed**, **Installed**, **Needs update**, or **Unavailable**. Unavailable
clients show the reason under the row and keep Add disabled (for example, a missing CLI). If Ark
moves or is reinstalled, a row may show **Needs update**; select **Update** to rewrite the
executable path.

The client configuration remains valid after Ark restarts. Start Ark and enable MCP before using
the tools. **Start automatically when Ark opens** can persist that preference; it is disabled by
default.

## Verify or remove the configuration

Use **Remove** on the client row in Settings when the integration is no longer needed. Stopping MCP
in Ark immediately revokes the current session but leaves the client configuration in place.
Removing the client configuration does not change Ark's autostart preference.

If you need to inspect or edit a client by hand, the CLIs still work as a fallback:

```bash
codex mcp get ark
claude mcp get ark
codex mcp remove ark
claude mcp remove ark
```

Typical manual add commands (the installed Ark path is required) look like:

```bash
codex mcp add ark -- "/path/to/Ark" --headless --mcp
claude mcp add --transport stdio --scope user ark -- "/path/to/Ark" --headless --mcp
```

Cursor merges `~/.cursor/mcp.json`. OpenCode merges its XDG `opencode.jsonc` (or `.json`). Grok and
Devin CLI use their official MCP add/remove commands, same as Codex and Claude Code.

## Scope and privacy

- MCP can read and edit only the presentation currently visible in Ark.
- Switching presentations changes the target of new calls; an in-flight write cannot be redirected to another deck.
- The external conversation remains in the MCP client and is not copied into Ark chat.
- On a blank deck, an external agent can show questions and visual theme samples inside Ark through
  `ask_user` and `propose_themes`. Ark returns the response through `wait_for_interaction`; pending
  interactions are temporary and disappear when MCP stops, the deck changes, or they expire.
- The client uses its own account and authentication. Ark's provider keys are not shared.
- Ark stores a temporary high-entropy capability in its per-user application-data directory only while MCP is running. The capability and internal API address are not exposed to the renderer.
- Requests stay on a random `127.0.0.1` loopback port. Writes use document revisions, so concurrent Ark and external edits fail with a recoverable conflict instead of silently overwriting one another.

## Troubleshooting

**The client says MCP is disabled.** Open Ark and select **Start MCP server**. The configured client process can recover without reinstalling the integration.

**No active deck is available.** Open a presentation in the Ark window, then retry `get_active_deck`.

**A write reports a document conflict.** The presentation changed after the client read it. Call `get_active_deck`, `parse_deck`, or `read_deck` again and retry with the new `documentRevision`.

**The client cannot launch Ark.** Select **Update** for that client in Settings after reinstalling or moving Ark. The stored command contains an absolute executable path. Remove the old `ark` MCP entry before adding it again if Update is not offered.

**A client row is Unavailable.** The reason under the row is the blocker (usually a missing CLI). Install that client's CLI, then reopen Settings and select **Add**.

**An edit is rejected as invalid HTML.** Keep the deck as one self-contained HTML document. External HTTP resources are blocked; use inline assets, existing Ark asset URLs, or approved `/api/runtimes/...` assets.

**The client still appears connected after stopping MCP.** The stdio bridge may remain visible to the client, but every tool call rechecks Ark's current session capability and is rejected while MCP is stopped. Closing the client ends its bridge process.
