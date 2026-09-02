import { type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatStore } from '@/state/chat-store.ts'

import { usePromptSubmit } from './usePromptSubmit'
import { WorkspaceRuntimeContext, type WorkspaceRuntimeValue } from './workspace-runtime-context'

const generateDeck = vi.fn()
const ensureBlankDeck = vi.fn(async () => 'deck-new')
const uploadDeckAsset = vi.fn()

vi.mock('@/lib/api/asset-api', () => ({
  uploadDeckAsset: (...args: unknown[]) => uploadDeckAsset(...args),
}))

function wrapper({ children }: { children: ReactNode }) {
  const value = {
    persistence: { deckId: 'deck-1', html: '<html></html>', ensureBlankDeck },
    generation: { generateDeck, isGenerating: false },
    models: {
      canGenerate: true,
      selectedModel: 'test-model',
      models: [{ id: 'test-model', available: true, supportsAttachments: true }],
    },
  } as unknown as WorkspaceRuntimeValue
  return (
    <MemoryRouter initialEntries={['/decks/deck-1']}>
      <WorkspaceRuntimeContext.Provider value={value}>{children}</WorkspaceRuntimeContext.Provider>
    </MemoryRouter>
  )
}

describe('usePromptSubmit', () => {
  beforeEach(() => {
    generateDeck.mockReset()
    ensureBlankDeck.mockClear()
    uploadDeckAsset.mockReset()
    useChatStore.getState().reset()
  })
  it('uploads attachments then starts generation', async () => {
    uploadDeckAsset.mockResolvedValueOnce({
      id: 'asset-1',
      mediaType: 'image/avif',
      filename: 'hero.avif',
      url: '/assets/hero.avif',
    })
    const { result } = renderHook(() => usePromptSubmit(), { wrapper })

    await act(async () => {
      await result.current.handlePromptSubmit({
        text: 'Use this',
        files: [
          { filename: 'hero.avif', mediaType: 'image/avif', url: 'data:image/avif;base64,AA' },
        ],
      })
    })

    expect(uploadDeckAsset).toHaveBeenCalledWith(
      'deck-1',
      expect.objectContaining({ filename: 'hero.avif' }),
    )
    expect(generateDeck).toHaveBeenCalledWith(
      'Use this',
      [expect.objectContaining({ assetId: 'asset-1' })],
      expect.objectContaining({ assetIds: ['asset-1'], deckId: 'deck-1' }),
    )
    expect(useChatStore.getState().input).toBe('')
  })

  it('parks a send on the queue while generating', async () => {
    const busyWrapper = ({ children }: { children: ReactNode }) => {
      const value = {
        persistence: { deckId: 'deck-1', html: '<html></html>', ensureBlankDeck },
        generation: { generateDeck, isGenerating: true },
        models: {
          canGenerate: true,
          selectedModel: 'test-model',
          models: [{ id: 'test-model', available: true, supportsAttachments: true }],
        },
      } as unknown as WorkspaceRuntimeValue
      return (
        <MemoryRouter initialEntries={['/decks/deck-1']}>
          <WorkspaceRuntimeContext.Provider value={value}>
            {children}
          </WorkspaceRuntimeContext.Provider>
        </MemoryRouter>
      )
    }
    const { result } = renderHook(() => usePromptSubmit(), { wrapper: busyWrapper })

    await act(async () => {
      await result.current.handlePromptSubmit({ text: 'queue me', files: [] })
    })

    expect(generateDeck).not.toHaveBeenCalled()
    expect(result.current.queuedSends).toEqual([
      expect.objectContaining({ text: 'queue me', attachmentCount: 0 }),
    ])
  })
})
