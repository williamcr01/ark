import { act, renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { getTestLocalStorage } from '@/test/storage'

import { useDeckActions } from './useDeckActions'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

function createDeckActionsOptions(
  overrides: {
    startNewDeck?: () => void
    deleteActiveDeck?: () => Promise<void>
    resetChat?: (targetDeckId?: string | null) => Promise<boolean>
  } = {},
) {
  const resetChat = overrides.resetChat ?? vi.fn(async () => true)
  const startNewDeck = overrides.startNewDeck ?? vi.fn()
  const deleteActiveDeck = overrides.deleteActiveDeck ?? vi.fn(async () => undefined)
  const setInput = vi.fn()
  const setError = vi.fn()

  return {
    options: {
      fileInputRef: createRef<HTMLInputElement | null>(),
      deck: {
        deckId: 'deck-1' as string | null,
        html: '<html></html>',
        persistHtml: vi.fn(),
        rollbackToVersion: vi.fn(),
        startNewDeck,
        renameActiveDeck: vi.fn(),
        deleteActiveDeck,
      },
      chat: {
        appendMessage: vi.fn(),
        setMessages: vi.fn(),
        resetChat,
      },
      setInput,
      setError,
    },
    resetChat,
    startNewDeck,
    deleteActiveDeck,
    setInput,
    setError,
  }
}

describe('useDeckActions', () => {
  it('starts a new deck by resetting the unsaved chat session explicitly', () => {
    getTestLocalStorage().setItem('ark:generation-job:new', 'job-old')
    const { options, resetChat, startNewDeck, setInput, setError } = createDeckActionsOptions()
    const { result } = renderHook(() => useDeckActions(options))

    act(() => {
      result.current.handleNewDeck()
    })

    expect(startNewDeck).toHaveBeenCalledTimes(1)
    expect(getTestLocalStorage().getItem('ark:generation-job:new')).toBeNull()
    expect(resetChat).toHaveBeenCalledExactlyOnceWith(null)
    expect(setInput).toHaveBeenCalledWith('')
    expect(setError).toHaveBeenCalledWith('')
  })

  it('clears the unsaved chat after deleting a deck instead of the stale deck ref', async () => {
    const { options, resetChat, deleteActiveDeck, setInput, setError } = createDeckActionsOptions()
    const { result } = renderHook(() => useDeckActions(options))

    await act(async () => {
      await result.current.handleDeleteDeck()
    })

    expect(deleteActiveDeck).toHaveBeenCalledTimes(1)
    expect(resetChat).toHaveBeenCalledExactlyOnceWith(null)
    expect(setInput).toHaveBeenCalledWith('')
    expect(setError).toHaveBeenCalledWith('')
  })
})
