# Ark

Ark is a local-first Electron presentation builder. Describe a deck in the side chat, edit it on the canvas, and export a portable single-page HTML presentation.

Ark is a desktop application only. The React renderer, local Express API, and isolated deck sandbox are packaged into one Electron app; there is no hosted web client or separately deployed backend.

## Installation

Download the installer for your platform from the official GitHub Releases page. On Linux, persistently saving AI provider keys requires a running, unlocked Secret Service keyring such as GNOME Keyring, KWallet, or KeePassXC; package names and startup steps vary by distribution and desktop environment.

## Development

Requirements:

- Node.js 24 or newer
- pnpm 11.5.3 through Corepack

```bash
pnpm install
pnpm dev
```

`pnpm dev` opens Ark in Electron and watches the renderer, main process, and preload bundle. The loopback HTTP services are private implementation details; open the Electron window, not their ports.

Add OpenAI, Anthropic, or Google Gemini keys from **Settings** inside Ark. Keys are encrypted with Electron `safeStorage` and remain on the local device. Ark does not read provider keys from `.env`.

Local coding agents can edit the presentation visible in Ark through the optional MCP integration. Start it from the cable button or **Settings → External agents (MCP)**, then copy the generated Codex or Claude Code command. See [docs/mcp.md](docs/mcp.md) for setup, removal, security, and troubleshooting.

## Local data

Each presentation is a portable `.ark` SQLite workspace containing the current HTML document, assets, conversations, and current thumbnail cache. New workspaces are created immediately in `Documents/Ark` by default; Settings can point that default at another directory, and Open/Save As/Move can place a workspace anywhere.

Electron's per-user `userData` directory contains the disposable recent-workspace index, preferences, and encrypted credentials:

- Linux: `~/.config/Ark`
- macOS: `~/Library/Application Support/Ark`
- Windows: `%APPDATA%\Ark`

Generation jobs are process-local, completed payloads are trimmed and bounded, and version history is not persisted. Undo/redo remains available for the current editing session. Ark uses the local filesystem only; PostgreSQL and cloud persistence are not part of the desktop application.

Provider keys are stored as encrypted values in `auth.json`. Appearance, selected model, and reasoning preferences are stored separately in `settings.json`. If operating-system secure storage is unavailable, a provider key can be kept in memory for the current Ark session without writing it to disk.

## Architecture

Electron owns two dynamically allocated loopback origins:

1. The app origin serves the built React renderer and internal `/api` routes.
2. The sandbox origin serves deck preview documents with strict CSP isolation.

The main process imports `apps/api` and `apps/sandbox` directly, points storage at `app.getPath('userData')`, and opens a hardened `BrowserWindow`. Deck HTML only runs inside the existing sandboxed preview iframe. Thumbnail PNGs are rendered by a hidden sandboxed Electron `BrowserWindow` and captured with `webContents.capturePage()`.

```text
apps/desktop/   Electron main/preload processes and React renderer
apps/api/       Internal local API and persistence services
apps/sandbox/   Separate-origin hostile deck renderer
packages/       Shared contracts, deck helpers, and runtime registry
runtimes/       Vendored approved deck runtimes
agent-guides/   Always-on built-in deck generation guidance
mcp-guides/     External-agent deck authoring guidance
```

## Commands

```bash
pnpm dev          # open the watched Electron development app
pnpm typecheck    # check every TypeScript project
pnpm lint         # run all lint checks
pnpm lint:eslint  # run ESLint alone
pnpm format       # format the repository
pnpm test         # run Vitest
pnpm build        # build renderer, main, and preload bundles
pnpm package                # create an unpacked app for the current platform
pnpm package:installers     # create installers for the current platform
```

Run `pnpm format` before committing.

## Desktop security

- Every `BrowserWindow` uses `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.
- The preload exposes only narrow credential, MCP lifecycle, file, settings, and updater IPC methods.
- Renderer sessions allow only Ark's exact loopback origins. Provider traffic originates from the local Node service, not deck or renderer frames.
- Deck previews use a separate loopback origin, short-lived render tokens, `sandbox="allow-scripts"`, and a strict CSP with `connect-src 'none'`.
- The Electron session blocks the residual frame self-navigation request that browsers cannot prevent with CSP alone.
- Provider keys are encrypted with the operating system's secure storage through Electron `safeStorage`.

See [docs/deck-bridge.md](docs/deck-bridge.md), [docs/deck-editor-bridge.md](docs/deck-editor-bridge.md), and [docs/runtimes.md](docs/runtimes.md) for deck isolation and bridge details.

## Packaging and releases

Electron Builder creates:

- Linux AppImage and Debian packages
- macOS DMG and ZIP packages
- Windows NSIS installers

Pushing a `v*` tag runs the three-platform release matrix in [release.yml](.github/workflows/release.yml) and publishes artifacts to GitHub Releases. Configure these repository secrets for signed releases:

- `MACOS_CERTIFICATE`, `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`

macOS builds use hardened runtime and notarization. Electron Builder consumes the configured certificates for macOS and Windows signing. Packaged builds use `electron-updater` to check GitHub Releases.

macOS and Windows updates retain their platform code-signing trust chain. Linux AppImage updates rely on GitHub HTTPS plus the release metadata checksum and do not have an independent platform signature; verify the first installation from the official GitHub Releases page.

Electron, Electron Builder, and Electron Updater are MIT-licensed.

## Deck format

Each presentation remains one self-contained HTML document with inline styles and optional approved runtimes. External HTTP resources are rejected. Decks can be exported from Ark and opened independently in a browser or presentation environment; only the Ark editor itself is Electron-only.
