# Local MCP integration

Ark can let Codex, Claude Code, or another local MCP client edit the presentation currently visible in the desktop app. The integration is off by default, works through the installed Ark executable, and does not require Node.js or an Ark API key.

## Set up a client

1. Open the presentation you want to share in Ark.
2. Select the cable button in the deck toolbar, or open **Settings → External agents (MCP)** and select **Start MCP server**.
3. Copy the generated command for your client and run it once in a terminal.
4. In the client, ask it to call `get_active_deck` before reading or editing the deck.

The generated command contains the absolute path to the installed Ark executable. Typical commands look like:

```bash
codex mcp add ark -- "/path/to/Ark" --headless --mcp
claude mcp add --transport stdio --scope user ark -- "/path/to/Ark" --headless --mcp
```

The client configuration remains valid after Ark restarts. Start Ark and enable MCP before using the tools. **Start automatically when Ark opens** can persist that preference; it is disabled by default.

## Verify or remove the configuration

Check that the client knows about Ark:

```bash
codex mcp get ark
claude mcp get ark
```

Remove the configuration when it is no longer needed:

```bash
codex mcp remove ark
claude mcp remove ark
```

Stopping MCP in Ark immediately revokes the current session but leaves the client configuration in place. Removing the client configuration does not change Ark's autostart preference.

## Scope and privacy

- MCP can read and edit only the presentation currently visible in Ark.
- Switching presentations changes the target of new calls; an in-flight write cannot be redirected to another deck.
- The external conversation remains in the MCP client and is not copied into Ark chat.
- The client uses its own account and authentication. Ark's provider keys are not shared.
- Ark stores a temporary high-entropy capability in its per-user application-data directory only while MCP is running. The capability and internal API address are not exposed to the renderer.
- Requests stay on a random `127.0.0.1` loopback port. Writes use document revisions, so concurrent Ark and external edits fail with a recoverable conflict instead of silently overwriting one another.

## Troubleshooting

**The client says MCP is disabled.** Open Ark and select **Start MCP server**. The configured client process can recover without reinstalling the integration.

**No active deck is available.** Open a presentation in the Ark window, then retry `get_active_deck`.

**A write reports a document conflict.** The presentation changed after the client read it. Call `get_active_deck`, `parse_deck`, or `read_deck` again and retry with the new `documentRevision`.

**The client cannot launch Ark.** Recopy the setup command after reinstalling or moving Ark; it contains an absolute executable path. Remove the old `ark` MCP entry before adding the new command.

**An edit is rejected as invalid HTML.** Keep the deck as one self-contained HTML document. External HTTP resources are blocked; use inline assets, existing Ark asset URLs, or approved `/api/runtimes/...` assets.

**The client still appears connected after stopping MCP.** The stdio bridge may remain visible to the client, but every tool call rechecks Ark's current session capability and is rejected while MCP is stopped. Closing the client ends its bridge process.
