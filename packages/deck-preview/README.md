# @ark/deck-preview

**One job:** turning a deck document into something safe to render in the preview frame, and
carrying the shell ↔ frame conversation while it is rendered.

Layer 2. May import `@ark/deck`, `@ark/editor-runtime`, `@ark/runtime-registry`. Browser-safe.

| Module              | Responsibility                                                       |
| ------------------- | -------------------------------------------------------------------- |
| `preview-html.ts`   | Builds the document served to the preview frame                      |
| `preview-slides.ts` | Preview-time script stripping and runtime CSP injection              |
| `thumbnail-html.ts` | The stripped, single-slide document thumbnails render from           |
| `deck-bridge.ts`    | The parent ↔ deck navigation protocol (`ark:deck-*`)                 |
| `slide-patch.ts`    | Swaps changed slides inside a loaded preview instead of reloading it |
| `csp-nonce.ts`      | Per-render nonces for the injected CSP                               |

Document-level sanitisation is not here: stripping inline handlers and `javascript:` URLs is in
`@ark/deck/document/sanitize.ts`, because patching a document has to strip the same vectors that
rendering one does.
