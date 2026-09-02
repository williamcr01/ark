import { describe, expect, it, vi } from 'vitest'

import { ApiResponseError } from '@ark/contracts'

import { runWorkspacePickFlow } from './workspace-pick-flow.ts'

describe('runWorkspacePickFlow', () => {
  it('saves on the first chosen path', async () => {
    window.arkDesktop.files.chooseWorkspacePath = vi.fn().mockResolvedValue('/tmp/Deck.ark')
    const action = vi.fn().mockResolvedValue(undefined)

    await runWorkspacePickFlow('Deck.ark', action, 'Workspace saved')

    expect(action).toHaveBeenCalledWith('/tmp/Deck.ark', false)
  })

  it('re-picks when the user declines overwrite', async () => {
    window.arkDesktop.files.chooseWorkspacePath = vi
      .fn()
      .mockResolvedValueOnce('/tmp/Deck.ark')
      .mockResolvedValueOnce('/tmp/Deck-2.ark')
    const action = vi
      .fn()
      .mockRejectedValueOnce(new ApiResponseError('exists', { code: 'workspace_file_exists' }))
      .mockResolvedValueOnce(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    await runWorkspacePickFlow('Deck.ark', action, 'Workspace saved')

    expect(window.arkDesktop.files.chooseWorkspacePath).toHaveBeenNthCalledWith(
      2,
      'Deck.ark',
      '/tmp/Deck.ark',
    )
    expect(action).toHaveBeenLastCalledWith('/tmp/Deck-2.ark', false)
  })

  it('overwrites when the user confirms', async () => {
    window.arkDesktop.files.chooseWorkspacePath = vi.fn().mockResolvedValue('/tmp/Deck.ark')
    const action = vi
      .fn()
      .mockRejectedValueOnce(new ApiResponseError('exists', { code: 'workspace_file_exists' }))
      .mockResolvedValueOnce(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    await runWorkspacePickFlow('Deck.ark', action, 'Workspace saved')

    expect(action).toHaveBeenLastCalledWith('/tmp/Deck.ark', true)
  })
})
