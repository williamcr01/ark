import { describe, expect, it } from 'vitest'

import { toWorkspaceFileName } from './workspace-file-name.ts'

describe('toWorkspaceFileName', () => {
  it('sanitizes filesystem-illegal characters', () => {
    expect(toWorkspaceFileName('Q3: Plan/Review')).toBe('Q3  Plan Review.ark')
  })

  it('falls back when the title is empty', () => {
    expect(toWorkspaceFileName('   ')).toBe('Untitled Presentation.ark')
  })
})
