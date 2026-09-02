# @ark/editor-runtime

**One job:** the manual editor — the protocol the shell and the deck frame speak, and the script
that runs inside the frame to implement it.

Layer 2. May import `@ark/deck` and `@ark/runtime-registry`. Browser-safe.

```
protocol/      message-types.ts  the wire identifiers
               types.ts          message and selection shapes
               guards.ts         validation of incoming postMessage payloads
               factories.ts      message constructors and the shell-side send helper
runtime-src/   typed iframe editor runtime (IIFE body). Edit these modules.
runtime/       script.ts         prepends host constants onto the committed bundle
               generated/        esbuild IIFE string module (committed artifact)
```

Author the iframe runtime as real TypeScript under `runtime-src/`. Shared mutable state lives in
`state.ts`; host values (`message-type` names, attribute names, sizes, `MAX_SELECTIONS`) arrive as
the global `C` object that `buildDeckEditorBridgeRuntimeScript` prepends. After editing
`runtime-src/`, run `pnpm build:runtimes` and commit the regenerated
`runtime/generated/editor-runtime.source.ts`. `pnpm build:runtimes:check` (and a vitest in this
package) fails if that file is stale.

`EditorNormalizedRect` is an alias for `NormalizedRect` in `@ark/deck/document/geometry.ts` — the
deck model needs the rect too, so it is defined below this package.

See [docs/deck-editor-bridge.md](../../docs/deck-editor-bridge.md).
