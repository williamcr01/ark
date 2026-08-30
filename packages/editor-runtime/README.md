# @ark/editor-runtime

**One job:** the manual editor — the protocol the shell and the deck frame speak, and the script
that runs inside the frame to implement it.

Layer 2. May import `@ark/deck` and `@ark/runtime-registry`. Browser-safe.

```
protocol/   message-types.ts  the wire identifiers
            types.ts          message and selection shapes
            guards.ts         validation of incoming postMessage payloads
            factories.ts      message constructors and the shell-side send helper
runtime/    script.ts         composes the chunks below into the injected script
            port, selection, surface, geometry, chrome, text-edit, transform,
            adopt, snap, pointer, keyboard, lifecycle
```

The injected script is one IIFE whose parts close over shared state, so it cannot become real
modules. The `runtime/` files are ordered source chunks of that one program, concatenated by
`script.ts`; each is a named section rather than an independent unit.

`EditorNormalizedRect` is an alias for `NormalizedRect` in `@ark/deck/document/geometry.ts` — the
deck model needs the rect too, so it is defined below this package.

See [docs/deck-editor-bridge.md](../../docs/deck-editor-bridge.md).
