# @ark/deck-node

**One job:** JSDOM HTML entry points for the deck document model. Parsing, timed
validation, and patch apply that construct a `Document` from a string live here.

Layer 2. May import `@ark/deck`, `@ark/runtime-registry`, `@ark/telemetry`, `jsdom`,
and `node:*`. **Server-only:** the renderer must not import it. Use `@ark/deck`
document/patch helpers with the browser `DOMParser` instead.

This package is a stub until the JSDOM wrappers move in from `@ark/deck`.
