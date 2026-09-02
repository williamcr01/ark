import { type DeckThemeColorRole } from '@ark/deck/document/theme.ts'

export const COLOR_LABELS: Record<DeckThemeColorRole, string> = {
  canvas: 'Canvas',
  surface: 'Surface',
  foreground: 'Text',
  muted: 'Muted',
  primary: 'Primary',
  secondary: 'Secondary',
  accent: 'Accent',
}

export function sampleSlides(html: string) {
  const marked = [...html.matchAll(/data-ark-slide-kind="([^"]+)"/g)].map((match, index) => ({
    index,
    kind: match[1]!,
    label: `${match[1]!.slice(0, 1).toUpperCase()}${match[1]!.slice(1)}`,
  }))
  if (marked.length > 0) return marked
  const count = Math.max(1, (html.match(/<section\b/gi) ?? []).length)
  return Array.from({ length: count }, (_, index) => ({
    index,
    kind: `slide-${index}`,
    label: count === 1 ? 'Preview' : `Slide ${index + 1}`,
  }))
}
