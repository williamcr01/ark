# @ark/deck-import

**One job:** turn a local PowerPoint (`.pptx`) file into a self-contained Ark HTML deck.

Layer 2. May import `@ark/deck` and `@ark/runtime-registry`. **Server-only:** it reads OOXML zips
with JSZip and jsdom, so the renderer must not import it. The local API owns the HTTP surface.
The public entry is `@ark/deck-import` (`index.ts`); deep imports remain supported.

Conversion stays on the machine. There is no commercial cloud convert. Round-trip identity with
PPTX export is not required.

| Module             | Responsibility                                             |
| ------------------ | ---------------------------------------------------------- |
| `detect.ts`        | Legacy `.ppt` and password-protected packages fail clearly |
| `parse-ooxml.ts`   | Slides, notes, shapes, pictures, charts, theme colors      |
| `emit-html.ts`     | Positioned HTML, Chart.js, and SVG plates for unmappables  |
| `import-pptx.ts`   | Public `importPptxToHtml` entry                            |
| `pptx-fixtures.ts` | Minimal OOXML builders for tests                           |

## Phases

1. A slide that cannot be mapped becomes one full-bleed image plus notes.
2. Text boxes, basic shapes, and pictures become `data-ark-managed` elements. Unmappable
   decoration (effects, SmartArt, complex groups) lands on a background plate.
3. Chart caches become Chart.js when the type and data are recoverable; otherwise the chart is
   flattened to an SVG picture. Fonts come from the existing registry only.
