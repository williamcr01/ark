# @ark/runtime-registry

**One job:** which third-party runtime assets a deck is allowed to load, and at which pinned
version. Nothing outside this package decides what is approved.

Layer 0 — the bottom of the stack. Imports no other workspace package. Browser-safe, except
`runtime-stylesheet-disk.ts`, whose name marks it as the Node-side reader.

| Module                          | Responsibility                             |
| ------------------------------- | ------------------------------------------ |
| `deck-runtime-registry.ts`      | The approved asset list and URL validation |
| `deck-runtime-manifest.ts`      | The manifest shape decks carry             |
| `deck-runtime.ts`               | Runtime mode detection and CSP injection   |
| `sandbox-origin.ts`             | Which loopback origins are Ark's           |
| `runtime-stylesheet-content.ts` | Runtime stylesheet text for thumbnails     |
| `runtime-stylesheet-disk.ts`    | Reads that text from `runtimes/` on disk   |

Vendored assets live in `runtimes/`; see [docs/runtimes.md](../../docs/runtimes.md).
