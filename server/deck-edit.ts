export type DeckEdit = {
  oldText: string
  newText: string
}

export type ApplyDeckEditsResult =
  | { ok: true; html: string; appliedCount: number }
  | { ok: false; error: string }

type MatchedEdit = {
  editIndex: number
  matchIndex: number
  matchLength: number
  newText: string
}

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

function applyReplacements(content: string, replacements: MatchedEdit[]) {
  const sorted = [...replacements].sort((a, b) => b.matchIndex - a.matchIndex)
  let result = content

  for (const replacement of sorted) {
    result =
      result.slice(0, replacement.matchIndex) +
      replacement.newText +
      result.slice(replacement.matchIndex + replacement.matchLength)
  }

  return result
}

/**
 * Apply exact-match edits against the original HTML (pi-style).
 * Each oldText must appear exactly once, and edit regions must not overlap.
 */
export function applyDeckEdits(html: string, edits: DeckEdit[]): ApplyDeckEditsResult {
  if (edits.length === 0) {
    return { ok: false, error: 'At least one edit is required.' }
  }

  const matchedEdits: MatchedEdit[] = []

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

    matchedEdits.push({
      editIndex: index,
      matchIndex: html.indexOf(edit.oldText),
      matchLength: edit.oldText.length,
      newText: edit.newText,
    })
  }

  matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex)

  for (let index = 1; index < matchedEdits.length; index += 1) {
    const previous = matchedEdits[index - 1]
    const current = matchedEdits[index]

    if (!previous || !current) {
      continue
    }

    if (previous.matchIndex + previous.matchLength > current.matchIndex) {
      return {
        ok: false,
        error: `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap. Merge them into one edit or target disjoint regions.`,
      }
    }
  }

  const updated = applyReplacements(html, matchedEdits)

  if (updated === html) {
    return {
      ok: false,
      error: 'None of the edits changed the deck. Check that newText differs from oldText.',
    }
  }

  return { ok: true, html: updated, appliedCount: edits.length }
}
