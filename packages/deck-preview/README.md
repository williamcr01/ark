# @ark/deck-preview

**One job:** turning a deck document into something safe to render in the preview frame, and
carrying the shell ↔ frame conversation while it is rendered.

Layer 3. May import `@ark/deck`, `@ark/editor-runtime`, `@ark/runtime-registry`. Browser-safe.
The public entry is `@ark/deck-preview` (`index.ts`); deep imports remain supported.

| Module                   | Responsibility                                                       |
| ------------------------ | -------------------------------------------------------------------- |
| `preview-html.ts`        | Builds the document served to the preview frame                      |
| `preview-html-inject.ts` | CSP, handshake, script/asset injection helpers                       |
| `preview-slides.ts`      | Preview-time script stripping and runtime CSP injection              |
| `thumbnail-html.ts`      | The stripped, single-slide document thumbnails render from           |
| `slide-patch.ts`         | Swaps changed slides inside a loaded preview instead of reloading it |
| `csp-nonce.ts`           | Per-render nonces for the injected CSP                               |

The parent ↔ deck navigation protocol (`ark:deck-*`) lives next to the injected iframe scripts:

```
protocol/      message-types.ts  the `ark:deck-*` wire identifiers
               types.ts          message and metadata shapes
               guards.ts         validation of incoming postMessage payloads
               factories.ts      message constructors and parent-side send helpers
runtime-src/   typed iframe runtimes (IIFE bodies). Edit these modules.
               handshake/        head-first `ark:deck-handshake` sentinel
               css-nav/          CSS-only navigation shim
               custom-bridge/    full-JS postMessage ↔ CustomEvent bridge
               reveal-adapter/   Reveal.js navigation adapter
               shared/           isRecord, clampIndex, postMessage, slide-patch
runtime/       builders prepend host constants onto the committed bundles
               generated/        esbuild IIFE string modules (committed artifacts)
```

Import the protocol and runtime from `@ark/deck-preview` (`index.ts`), or from
`protocol/` and `runtime/` directly.

Author the iframe runtimes as real TypeScript under `runtime-src/`. Host values (slide selectors,
preview mode, handshake id, parent origin, message-type names, protocol version) arrive as the `C`
argument that `buildDeckCssNavRuntimeScript`, `buildDeckBridgeRuntimeScript`,
`buildRevealNavRuntimeScript`, and `buildDeckHandshakeSentinelScript` pass into the bundled IIFE.
Builders wrap constants that way so a later nav/bridge script cannot overwrite the editor runtime's
global `C`. After editing `runtime-src/`, run `pnpm build:runtimes` and commit the regenerated
`runtime/generated/*.source.ts` files. `pnpm build:runtimes:check` (and a vitest in this package)
fails if those files are stale.

Document-level sanitisation is not here: stripping inline handlers and `javascript:` URLs is in
`@ark/deck/document/sanitize.ts`, because patching a document has to strip the same vectors that
rendering one does.
