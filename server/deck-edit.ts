export type DeckEdit = {
  oldText: string
  newText: string
}

export type ApplyDeckEditsResult =
  | { ok: true; html: string; appliedCount: number }
  | { ok: false; error: string }

function countOccurrences(source: string, needle: string) {
  if (needle.length === 0) {
    return 0
  }

  let count = 0
  let index = 0

  while (index <= source.length - needle.length) {
    const nextIndex = source.indexOf(needle, index)

    if (nextIndex === -1) {
      break
    }

    count += 1
    index = nextIndex + needle.length
  }

  return count
}

/**
 * Apply exact-match edits against the original HTML (pi-style).
 * Each oldText must appear exactly once in the source document.
 */
export function applyDeckEdits(html: string, edits: DeckEdit[]): ApplyDeckEditsResult {
  if (edits.length === 0) {
    return { ok: false, error: 'At least one edit is required.' }
  }

  for (const [index, edit] of edits.entries()) {
    if (!edit.oldText) {
      return { ok: false, error: `edits[${index}].oldText must not be empty.` }
    }

    const occurrences = countOccurrences(html, edit.oldText)

    if (occurrences === 0) {
      const preview = edit.oldText.slice(0, 120).replace(/\s+/g, ' ')
      return {
        ok: false,
        error: `edits[${index}].oldText was not found in the deck. Preview: "${preview}"`,
      }
    }

    if (occurrences > 1) {
      return {
        ok: false,
        error: `edits[${index}].oldText appears ${occurrences} times. Include more surrounding context so the match is unique.`,
      }
    }
  }

  let updated = html

  for (const edit of edits) {
    updated = updated.replace(edit.oldText, edit.newText)
  }

  return { ok: true, html: updated, appliedCount: edits.length }
}
