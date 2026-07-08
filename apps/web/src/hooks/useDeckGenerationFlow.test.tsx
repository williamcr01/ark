import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GenerationJobApi } from '@ark/contracts'
import type { ChatMessage } from '@ark/deck-core/chat.ts'

import { useDeckGenerationFlow, type UseDeckGenerationFlowOptions } from './useDeckGenerationFlow'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/lib/generation-job-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/generation-job-api')>()
  return {
    ...actual,
    startGenerationJob: vi.fn(),
    fetchGenerationJob: vi.fn(),
    cancelGenerationJob: vi.fn(),
    retryGenerationJob: vi.fn(),
  }
})

const { startGenerationJob, fetchGenerationJob, cancelGenerationJob, retryGenerationJob } =
  await import('@/lib/generation-job-api')

const startGenerationJobMock = vi.mocked(startGenerationJob)
const fetchGenerationJobMock = vi.mocked(fetchGenerationJob)
const cancelGenerationJobMock = vi.mocked(cancelGenerationJob)
const retryGenerationJobMock = vi.mocked(retryGenerationJob)

const STORAGE_PREFIX = 'ark:generation-job:'

function makeJob(overrides: Partial<GenerationJobApi> = {}): GenerationJobApi {
  return {
    id: 'job-1',
    deckId: 'deck-1',
    baseVersionId: null,
    editingExistingDeck: false,
    status: 'queued',
    model: 'test-model',
    provider: 'test',
    progress: { steps: [], stepCount: 0, assistantText: null },
    observability: null,
    result: null,
    error: null,
    retryOfJobId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    ...overrides,
  }
}

type JobResult = NonNullable<GenerationJobApi['result']>

const succeededResult: JobResult = {
  deckId: 'deck-1',
  versionId: 'v1',
  validation: { status: 'valid', issues: [] } as unknown as JobResult['validation'],
  assistantText: 'Generated the deck.',
}

type Harness = {
  options: UseDeckGenerationFlowOptions
  refreshActiveDeck: ReturnType<typeof vi.fn>
  appendMessage: ReturnType<typeof vi.fn>
  reloadChat: ReturnType<typeof vi.fn>
  setMessages: ReturnType<typeof vi.fn>
  loadModels: ReturnType<typeof vi.fn>
  onError: ReturnType<typeof vi.fn>
  onGenerationStart: ReturnType<typeof vi.fn>
}

function makeHarness(
  overrides: {
    deckId?: string | null
    messages?: ChatMessage[]
    canGenerate?: boolean
  } = {},
): Harness {
  const refreshActiveDeck = vi.fn(async () => undefined)
  const appendMessage = vi.fn(async () => undefined)
  const reloadChat = vi.fn(async () => [] as ChatMessage[])
  const setMessages = vi.fn()
  const loadModels = vi.fn(async () => undefined)
  const onError = vi.fn()
  const onGenerationStart = vi.fn()

  const options: UseDeckGenerationFlowOptions = {
    deck: {
      deckId: overrides.deckId ?? 'deck-1',
      activeVersionId: 'version-1',
      generatedHtml: '<html></html>',
      isDeckLoading: false,
      refreshActiveDeck,
    },
    chat: {
      messages: overrides.messages ?? [],
      appendMessage,
      reloadChat,
      setMessages,
    },
    selectedModel: 'test-model',
    canGenerate: overrides.canGenerate ?? true,
    loadModels,
    onError,
    onGenerationStart,
  }

  return {
    options,
    refreshActiveDeck,
    appendMessage,
    reloadChat,
    setMessages,
    loadModels,
    onError,
    onGenerationStart,
  }
}

describe('useDeckGenerationFlow', () => {
  beforeEach(() => {
    localStorage.clear()
    startGenerationJobMock.mockReset()
    fetchGenerationJobMock.mockReset()
    cancelGenerationJobMock.mockReset()
    retryGenerationJobMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('applies a succeeded outcome (deck refresh + chat reload)', async () => {
    const harness = makeHarness({ deckId: 'deck-1' })
    startGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-1', status: 'queued' }))
    fetchGenerationJobMock.mockResolvedValue(
      makeJob({ id: 'job-1', status: 'succeeded', result: succeededResult }),
    )

    const { result } = renderHook(() => useDeckGenerationFlow(harness.options))

    await act(async () => {
      await result.current.generateDeck('make slides')
    })

    expect(harness.onGenerationStart).toHaveBeenCalledTimes(1)
    expect(harness.appendMessage).toHaveBeenCalledTimes(1)
    expect(startGenerationJobMock).toHaveBeenCalledTimes(1)
    expect(harness.refreshActiveDeck).toHaveBeenCalledWith('deck-1')
    expect(harness.reloadChat).toHaveBeenCalledWith('deck-1')
    expect(result.current.generationError).toBe('')
  })

  it('forwards editor selection context in the start request', async () => {
    const harness = makeHarness({ deckId: 'deck-1' })
    startGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-1', status: 'queued' }))
    fetchGenerationJobMock.mockResolvedValue(
      makeJob({ id: 'job-1', status: 'succeeded', result: succeededResult }),
    )

    const { result } = renderHook(() => useDeckGenerationFlow(harness.options))

    const editorSelection = {
      slideIndex: 2,
      elementId: 'ark-el-9',
      elementKind: 'text',
      managed: true,
    }

    await act(async () => {
      await result.current.generateDeck('make this punchier', [], { editorSelection })
    })

    expect(startGenerationJobMock).toHaveBeenCalledTimes(1)
    expect(startGenerationJobMock.mock.calls[0]?.[0]).toMatchObject({ editorSelection })
  })

  it('omits editor selection when none is provided', async () => {
    const harness = makeHarness({ deckId: 'deck-1' })
    startGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-1', status: 'queued' }))
    fetchGenerationJobMock.mockResolvedValue(
      makeJob({ id: 'job-1', status: 'succeeded', result: succeededResult }),
    )

    const { result } = renderHook(() => useDeckGenerationFlow(harness.options))

    await act(async () => {
      await result.current.generateDeck('make slides')
    })

    expect(startGenerationJobMock).toHaveBeenCalledTimes(1)
    expect(startGenerationJobMock.mock.calls[0]?.[0]).not.toHaveProperty('editorSelection')
  })

  it('surfaces a failure without corrupting deck state', async () => {
    const harness = makeHarness({ deckId: 'deck-1' })
    startGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-1', status: 'queued' }))
    fetchGenerationJobMock.mockResolvedValue(
      makeJob({
        id: 'job-1',
        status: 'failed',
        error: { message: 'Model exploded', code: null },
      }),
    )

    const { result } = renderHook(() => useDeckGenerationFlow(harness.options))

    await act(async () => {
      await result.current.generateDeck('make slides')
    })

    expect(harness.onError).toHaveBeenCalledWith('Model exploded')
    expect(harness.refreshActiveDeck).not.toHaveBeenCalled()
    expect(harness.reloadChat).toHaveBeenCalled()
    await waitFor(() => {
      expect(result.current.failedJobId).toBe('job-1')
    })
  })

  it('does not start generating when canGenerate is false', async () => {
    const harness = makeHarness({ deckId: 'deck-1', canGenerate: false })

    const { result } = renderHook(() => useDeckGenerationFlow(harness.options))

    await act(async () => {
      await result.current.generateDeck('make slides')
    })

    expect(startGenerationJobMock).not.toHaveBeenCalled()
    expect(harness.appendMessage).not.toHaveBeenCalled()
  })

  it('cancels an active generation job', async () => {
    const harness = makeHarness({ deckId: 'deck-1' })
    startGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-1', status: 'running' }))
    fetchGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-1', status: 'running' }))
    cancelGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-1', status: 'canceled' }))

    const { result, unmount } = renderHook(() => useDeckGenerationFlow(harness.options))

    act(() => {
      void result.current.generateDeck('make slides')
    })

    await waitFor(() => {
      expect(result.current.isGenerating).toBe(true)
      expect(startGenerationJobMock).toHaveBeenCalled()
    })

    await act(async () => {
      await result.current.cancelGeneration()
    })

    expect(cancelGenerationJobMock).toHaveBeenCalledWith('job-1')

    unmount()
  })

  it('retries a failed generation job', async () => {
    const harness = makeHarness({ deckId: 'deck-1' })
    startGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-1', status: 'queued' }))
    fetchGenerationJobMock.mockResolvedValueOnce(
      makeJob({ id: 'job-1', status: 'failed', error: { message: 'boom', code: null } }),
    )

    const { result } = renderHook(() => useDeckGenerationFlow(harness.options))

    await act(async () => {
      await result.current.generateDeck('make slides')
    })

    await waitFor(() => {
      expect(result.current.failedJobId).toBe('job-1')
    })

    retryGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-2', status: 'queued' }))
    fetchGenerationJobMock.mockResolvedValue(
      makeJob({ id: 'job-2', status: 'succeeded', result: succeededResult }),
    )

    await act(async () => {
      await result.current.retryGeneration()
    })

    expect(retryGenerationJobMock).toHaveBeenCalledWith('job-1')
    expect(harness.refreshActiveDeck).toHaveBeenCalledWith('deck-1')
  })

  it('recovers a pending job stored in localStorage on mount', async () => {
    const harness = makeHarness({ deckId: 'deck-1' })
    localStorage.setItem(`${STORAGE_PREFIX}deck-1`, 'job-stored')
    fetchGenerationJobMock
      .mockResolvedValueOnce(makeJob({ id: 'job-stored', status: 'running' }))
      .mockResolvedValue(
        makeJob({ id: 'job-stored', status: 'succeeded', result: succeededResult }),
      )

    renderHook(() => useDeckGenerationFlow(harness.options))

    await waitFor(() => {
      expect(fetchGenerationJobMock).toHaveBeenCalledWith('job-stored')
    })

    await waitFor(() => {
      expect(harness.refreshActiveDeck).toHaveBeenCalledWith('deck-1')
    })
  })
})
