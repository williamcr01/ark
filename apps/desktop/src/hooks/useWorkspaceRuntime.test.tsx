import { renderHook } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { useWorkspaceRuntime } from './useWorkspaceRuntime'

const persistenceState = vi.hoisted(() => ({
  origin: 'authored' as 'blank' | 'authored' | null,
}))

vi.mock('./useDeckPersistence', () => ({
  useDeckPersistence: () => ({
    deckId: 'deck-1',
    deckTitle: 'Deck',
    documentRevision: 1,
    html: '<html></html>',
    isLoading: false,
    origin: persistenceState.origin,
    refreshActiveDeck: vi.fn(),
  }),
}))

vi.mock('./useChatSession', () => ({
  useChatSession: () => ({
    messages: [],
    appendMessage: vi.fn(),
    reloadChat: vi.fn(),
    setMessages: vi.fn(),
    getMessageDeliveryStatus: vi.fn(),
    retryPersist: vi.fn(),
    resetChat: vi.fn(),
  }),
}))

vi.mock('./useAvailableModels', () => ({
  useAvailableModels: () => ({
    canGenerate: true,
    selectedModel: 'test-model',
    models: [],
    loadModels: vi.fn(),
    isLoading: false,
    error: '',
    warnings: [],
    setSelectedModel: vi.fn(),
  }),
}))

vi.mock('./useDeckGenerationFlow', () => ({
  useDeckGenerationFlow: () => ({
    generateDeck: vi.fn(),
    isGenerating: false,
    isPreviewUpdating: false,
    isModelFailure: false,
    activeJobId: null,
    activeSteps: [],
    failedJobId: null,
    generationError: '',
    generationStatus: null,
    recentGenerationJobId: null,
    cancelGeneration: vi.fn(),
    retryGeneration: vi.fn(),
  }),
}))

function renderRuntime(path = '/decks/deck-1') {
  return renderHook(() => useWorkspaceRuntime(), {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={children}>
            <Route index element={null} />
            <Route path="decks/:deckId" element={null} />
          </Route>
        </Routes>
      </MemoryRouter>
    ),
  })
}

describe('useWorkspaceRuntime', () => {
  it('reports editor mode for an authored routed deck', () => {
    persistenceState.origin = 'authored'
    const { result } = renderRuntime()
    expect(result.current.workspaceMode).toBe('editor')
    expect(result.current.persistence.deckId).toBe('deck-1')
  })

  it('reports creation mode for a blank origin', () => {
    persistenceState.origin = 'blank'
    const { result } = renderRuntime()
    expect(result.current.workspaceMode).toBe('create')
  })
})
