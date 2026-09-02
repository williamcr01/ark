import { describe, expect, it } from 'vitest'

import { resolveWorkspaceMode, routeDeckIdFromParam } from './workspace-mode.ts'

describe('resolveWorkspaceMode', () => {
  it('uses the creation workspace for a blank origin', () => {
    expect(resolveWorkspaceMode('blank', 'deck-1', false)).toBe('create')
  })

  it('uses the creation workspace when the route has no deck id', () => {
    expect(resolveWorkspaceMode('authored', null, false)).toBe('create')
  })

  it('shows loading while origin is still unknown', () => {
    expect(resolveWorkspaceMode(null, 'deck-1', true)).toBe('loading')
  })

  it('uses the editor once origin is known', () => {
    expect(resolveWorkspaceMode('authored', 'deck-1', false)).toBe('editor')
    expect(resolveWorkspaceMode(undefined, 'deck-1', false)).toBe('editor')
  })
})

describe('routeDeckIdFromParam', () => {
  it('treats missing and "new" as no route deck', () => {
    expect(routeDeckIdFromParam(undefined)).toBeNull()
    expect(routeDeckIdFromParam('new')).toBeNull()
    expect(routeDeckIdFromParam('deck-1')).toBe('deck-1')
  })
})
