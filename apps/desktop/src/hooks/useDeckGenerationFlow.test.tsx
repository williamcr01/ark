import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GenerationJobApi } from '@ark/contracts'
import type { ChatMessage } from '@ark/chat/messages.ts'

import { useDeckGenerationFlow, type UseDeckGenerationFlowOptions } from './useDeckGenerationFlow'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/lib/api/generation-job-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/generation-job-api')>()
  return {
    ...actual,
    startGenerationJob: vi.fn(),
    fetchGenerationJob: vi.fn(),
    cancelGenerationJob: vi.fn(),
    retryGenerationJob: vi.fn(),
  }
})

const { startGenerationJob, fetchGenerationJob, cancelGenerationJob, retryGenerationJob } =
  await import('@/lib/api/generation-job-api')
const { toast } = await import('sonner')

const startGenerationJobMock = vi.mocked(startGenerationJob)
const fetchGenerationJobMock = vi.mocked(fetchGenerationJob)
const cancelGenerationJobMock = vi.mocked(cancelGenerationJob)
const retryGenerationJobMock = vi.mocked(retryGenerationJob)

const STORAGE_PREFIX = 'ark:generation-job:'

function makeJob(overrides: Partial<GenerationJobApi> = {}): GenerationJobApi {
  return {
    id: 'job-1',
    deckId: 'deck-1',
    baseDocumentRevision: null,
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
  documentRevision: 1,
  validation: {
    valid: true,
    slideCount: 1,
    scripts: [],
    forms: 0,
    iframes: 0,
    externalUrls: [],
    malformedSlides: [],
    runtimeMarkers: {
      runtimeMode: 'plain',
      arkDeck: null,
      arkPreview: null,
      arkRuntime: null,
      arkRuntimeLib: null,
      arkRuntimeVersion: null,
      approvedRuntimeId: null,
      approvedRuntimeVersion: null,
    },
    issues: [],
  },
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
  onGenerationSucceeded: ReturnType<typeof vi.fn>
}

function makeHarness(
  overrides: {
    deckId?: string | null
    documentRevision?: number | null
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
  const onGenerationSucceeded = vi.fn()

  const options: UseDeckGenerationFlowOptions = {
    deck: {
      deckId: overrides.deckId === undefined ? 'deck-1' : overrides.deckId,
      documentRevision: overrides.documentRevision === undefined ? 1 : overrides.documentRevision,
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
    onGenerationSucceeded,
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
    onGenerationSucceeded,
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

  it('applies a succeeded outcome (deck refresh + local assistant message)', async () => {
    const harness = makeHarness({ deckId: 'deck-1', documentRevision: 1 })
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
    expect(harness.reloadChat).not.toHaveBeenCalled()
    const updateMessages = harness.setMessages.mock.calls.at(-1)?.[0] as
      ((current: ChatMessage[]) => ChatMessage[]) | undefined
    const next = updateMessages?.([{ id: 'u1', role: 'user', content: 'make slides' }])
    expect(next?.at(-1)).toMatchObject({
      id: 'job-1',
      role: 'assistant',
    })
    expect(result.current.generationError).toBe('')
    expect(result.current.recentGenerationJobId).toBe('job-1')
    expect(harness.onGenerationSucceeded).toHaveBeenCalledWith({
      beforeHtml: '<html></html>',
      afterHtml: '<html></html>',
      deckChanged: false,
    })
  })

  it('reports one agent-turn history change when generation writes new HTML', async () => {
    const harness = makeHarness({ deckId: 'deck-1', documentRevision: 1 })
    harness.refreshActiveDeck.mockResolvedValue({ html: '<html>generated</html>' })
    startGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-1', status: 'queued' }))
    fetchGenerationJobMock.mockResolvedValue(
      makeJob({
        id: 'job-1',
        status: 'succeeded',
        result: { ...succeededResult, documentRevision: 2 },
      }),
    )

    const { result } = renderHook(() => useDeckGenerationFlow(harness.options))

    await act(async () => {
      await result.current.generateDeck('make slides')
    })

    expect(harness.onGenerationSucceeded).toHaveBeenCalledWith({
      beforeHtml: '<html></html>',
      afterHtml: '<html>generated</html>',
      deckChanged: true,
    })
  })

  it('reports a refresh failure and records no undo step when refresh throws', async () => {
    const harness = makeHarness({ deckId: 'deck-1', documentRevision: 1 })
    harness.refreshActiveDeck.mockRejectedValue(new Error('stale request'))
    startGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-1', status: 'queued' }))
    fetchGenerationJobMock.mockResolvedValue(
      makeJob({
        id: 'job-1',
        status: 'succeeded',
        result: { ...succeededResult, documentRevision: 2 },
      }),
    )

    const { result } = renderHook(() => useDeckGenerationFlow(harness.options))

    await act(async () => {
      await result.current.generateDeck('make slides')
    })

    // No after-snapshot exists, so there is nothing reversible to push onto the
    // stack: an entry with beforeHtml === afterHtml would be dropped anyway.
    expect(harness.onGenerationSucceeded).toHaveBeenCalledWith({
      beforeHtml: '<html></html>',
      afterHtml: '<html></html>',
      deckChanged: false,
    })
    expect(toast.error).toHaveBeenCalledWith(
      'Deck generated but could not be refreshed in the editor',
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('records no undo step for a job recovered after a reload with no send-time snapshot', async () => {
    // The job finished while the app was closed, so the deck already holds the
    // agent's write when it is recovered. beforeHtml must come from the loaded
    // deck, never from an empty send-time snapshot that Undo would apply.
    const harness = makeHarness({ deckId: 'deck-1' })
    harness.options.deck.generatedHtml = '<html>recovered</html>'
    harness.refreshActiveDeck.mockResolvedValue({ html: '<html>recovered</html>' })
    localStorage.setItem(`${STORAGE_PREFIX}deck-1`, 'job-stored')
    fetchGenerationJobMock
      .mockResolvedValueOnce(makeJob({ id: 'job-stored', status: 'running' }))
      .mockResolvedValue(
        makeJob({
          id: 'job-stored',
          status: 'succeeded',
          result: { ...succeededResult, documentRevision: 2 },
        }),
      )

    renderHook(() => useDeckGenerationFlow(harness.options))

    await waitFor(() => {
      expect(harness.onGenerationSucceeded).toHaveBeenCalled()
    })

    expect(harness.onGenerationSucceeded).toHaveBeenCalledWith({
      beforeHtml: '<html>recovered</html>',
      afterHtml: '<html>recovered</html>',
      deckChanged: false,
    })
  })

  it('treats a superseded refresh as a successful run with no undo step', async () => {
    const harness = makeHarness({ deckId: 'deck-1', documentRevision: 1 })
    harness.refreshActiveDeck.mockResolvedValue(null)
    startGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-1', status: 'queued' }))
    fetchGenerationJobMock.mockResolvedValue(
      makeJob({
        id: 'job-1',
        status: 'succeeded',
        result: { ...succeededResult, documentRevision: 2 },
      }),
    )

    const { result } = renderHook(() => useDeckGenerationFlow(harness.options))

    await act(async () => {
      await result.current.generateDeck('make slides')
    })

    // refreshActiveDeck resolves to null when a newer save or a deck switch
    // supersedes the refresh. Nothing failed, so the run reports success.
    expect(harness.onGenerationSucceeded).toHaveBeenCalledWith({
      beforeHtml: '<html></html>',
      afterHtml: '<html></html>',
      deckChanged: false,
    })
    expect(toast.error).not.toHaveBeenCalledWith(
      'Deck generated but could not be refreshed in the editor',
    )
    expect(toast.success).toHaveBeenCalled()
  })

  it('snapshots the undo beforeHtml at job completion, not at send time', async () => {
    const harness = makeHarness({ deckId: 'deck-1', documentRevision: 1 })
    harness.options.deck.generatedHtml = '<html>at-start</html>'
    harness.refreshActiveDeck.mockResolvedValue({ html: '<html>generated</html>' })
    startGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-1', status: 'queued' }))
    let resolveFetch: (job: GenerationJobApi) => void = () => {}
    fetchGenerationJobMock.mockImplementation(
      () =>
        new Promise<GenerationJobApi>((resolve) => {
          resolveFetch = resolve
        }),
    )

    const { result, rerender } = renderHook(
      (options: UseDeckGenerationFlowOptions) => useDeckGenerationFlow(options),
      { initialProps: harness.options },
    )

    act(() => {
      void result.current.generateDeck('make slides')
    })

    await waitFor(() => {
      expect(startGenerationJobMock).toHaveBeenCalled()
    })

    rerender({
      ...harness.options,
      deck: {
        ...harness.options.deck,
        generatedHtml: '<html>changed-during-job</html>',
      },
    })

    await act(async () => {
      resolveFetch(
        makeJob({
          id: 'job-1',
          status: 'succeeded',
          result: { ...succeededResult, documentRevision: 2 },
        }),
      )
      await Promise.resolve()
    })

    // An edit that landed during the job belongs to its own stack entry, so it
    // must not be folded into the agent turn's beforeHtml.
    expect(harness.onGenerationSucceeded).toHaveBeenCalledWith({
      beforeHtml: '<html>changed-during-job</html>',
      afterHtml: '<html>generated</html>',
      deckChanged: true,
    })
  })

  it('correlates recentGenerationJobId only to a succeeded job for the active revision', async () => {
    const harness = makeHarness({ deckId: 'deck-1', documentRevision: 2 })
    startGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-1', status: 'queued' }))
    fetchGenerationJobMock.mockResolvedValue(
      makeJob({ id: 'job-1', status: 'succeeded', result: succeededResult }),
    )

    const { result, rerender } = renderHook(
      (options: UseDeckGenerationFlowOptions) => useDeckGenerationFlow(options),
      { initialProps: harness.options },
    )

    await act(async () => {
      await result.current.generateDeck('make slides')
    })

    // The active document still points at a prior/manual revision — do not correlate.
    expect(result.current.recentGenerationJobId).toBeNull()

    rerender({
      ...harness.options,
      deck: {
        ...harness.options.deck,
        documentRevision: 1,
      },
    })
    expect(result.current.recentGenerationJobId).toBe('job-1')
  })

  it('does not correlate failed or canceled generation jobs', async () => {
    const harness = makeHarness({ deckId: 'deck-1', documentRevision: 1 })
    startGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-1', status: 'queued' }))
    fetchGenerationJobMock.mockResolvedValue(
      makeJob({
        id: 'job-1',
        status: 'failed',
        error: { message: 'boom' },
      }),
    )

    const { result } = renderHook(() => useDeckGenerationFlow(harness.options))

    await act(async () => {
      await result.current.generateDeck('make slides')
    })

    expect(result.current.recentGenerationJobId).toBeNull()
  })

  it('flags the preview only while a new document revision is being refreshed', async () => {
    const harness = makeHarness({ deckId: 'deck-1' })
    let resolveRefresh = () => {}
    harness.refreshActiveDeck.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve
        }),
    )
    startGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-1', status: 'queued' }))
    fetchGenerationJobMock.mockResolvedValue(
      makeJob({
        id: 'job-1',
        status: 'succeeded',
        result: { ...succeededResult, documentRevision: 2 },
      }),
    )

    const { result } = renderHook(() => useDeckGenerationFlow(harness.options))
    let generationPromise = Promise.resolve()

    act(() => {
      generationPromise = result.current.generateDeck('make slides')
    })

    await waitFor(() => {
      expect(harness.refreshActiveDeck).toHaveBeenCalledWith('deck-1')
      expect(result.current.isPreviewUpdating).toBe(true)
    })

    // Assistant turn should already be in local chat before the deck refresh finishes.
    expect(harness.setMessages).toHaveBeenCalled()
    const updateMessages = harness.setMessages.mock.calls.at(-1)?.[0] as
      ((current: ChatMessage[]) => ChatMessage[]) | undefined
    expect(
      updateMessages?.([{ id: 'u1', role: 'user', content: 'make slides' }])?.at(-1),
    ).toMatchObject({
      id: 'job-1',
      role: 'assistant',
    })

    await act(async () => {
      resolveRefresh()
      await generationPromise
    })

    expect(result.current.isPreviewUpdating).toBe(false)
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
    const slideContexts = [{ slideIndex: 2, title: 'Market' }]

    await act(async () => {
      await result.current.generateDeck('make this punchier', [], {
        editorSelection,
        slideContexts,
      })
    })

    expect(startGenerationJobMock).toHaveBeenCalledTimes(1)
    expect(startGenerationJobMock.mock.calls[0]?.[0]).toMatchObject({
      editorSelection,
      editorSelections: [editorSelection],
      slideContexts,
    })
    expect(harness.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        content: 'make this punchier',
        context: { editorSelection, editorSelections: [editorSelection], slideContexts },
      }),
      'deck-1',
    )
  })

  it('forwards the full editorSelections set with the primary as singular', async () => {
    const harness = makeHarness({ deckId: 'deck-1' })
    startGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-1', status: 'queued' }))
    fetchGenerationJobMock.mockResolvedValue(
      makeJob({ id: 'job-1', status: 'succeeded', result: succeededResult }),
    )

    const { result } = renderHook(() => useDeckGenerationFlow(harness.options))

    const editorSelection = {
      slideIndex: 1,
      elementId: 'ark-el-primary',
      elementKind: 'text',
    }
    const editorSelections = [
      { slideIndex: 1, elementId: 'ark-el-a', elementKind: 'text' },
      editorSelection,
      { slideIndex: 1, elementId: 'ark-el-c' },
    ]

    await act(async () => {
      await result.current.generateDeck('align these', [], {
        editorSelection,
        editorSelections,
      })
    })

    expect(startGenerationJobMock.mock.calls[0]?.[0]).toMatchObject({
      editorSelection,
      editorSelections,
    })
    expect(harness.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { editorSelection, editorSelections },
      }),
      'deck-1',
    )
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
    expect(startGenerationJobMock.mock.calls[0]?.[0]).not.toHaveProperty('editorSelections')
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

  it('keeps provider failures in chat without a shell error', async () => {
    const harness = makeHarness({ deckId: null })
    startGenerationJobMock.mockResolvedValue(makeJob({ id: 'job-1', status: 'queued' }))
    fetchGenerationJobMock.mockResolvedValue(
      makeJob({
        id: 'job-1',
        deckId: null,
        status: 'failed',
        error: {
          message: 'The provider rejected the request.',
          code: 'provider_error',
          errorCategory: 'provider_error',
        },
      }),
    )

    const { result } = renderHook(() => useDeckGenerationFlow(harness.options))

    await act(async () => {
      await result.current.generateDeck('make slides')
    })

    expect(harness.onError).toHaveBeenCalledWith('')
    expect(harness.onError).not.toHaveBeenCalledWith('The provider rejected the request.')
    expect(result.current.generationError).toBe('')
    expect(result.current.isModelFailure).toBe(true)

    const updateMessages = harness.setMessages.mock.calls.at(-1)?.[0] as
      ((current: ChatMessage[]) => ChatMessage[]) | undefined
    expect(
      updateMessages?.([{ id: 'u1', role: 'user', content: 'make slides' }]).at(-1)?.content,
    ).toBe('The model failed to generate the deck. The provider rejected the request.')
  })

  it('treats bare provider_error start failures as normal errors', async () => {
    const harness = makeHarness({ deckId: null })
    startGenerationJobMock.mockRejectedValue(
      Object.assign(new Error('GPT-5.4 Mini is text-only and does not support attachments.'), {
        code: 'provider_error',
      }),
    )

    const { result } = renderHook(() => useDeckGenerationFlow(harness.options))

    await act(async () => {
      await result.current.generateDeck('make slides')
    })

    expect(result.current.isModelFailure).toBe(false)
    expect(harness.onError).toHaveBeenCalledWith(
      'GPT-5.4 Mini is text-only and does not support attachments.',
    )

    const updateMessages = harness.setMessages.mock.calls.at(-1)?.[0] as
      ((current: ChatMessage[]) => ChatMessage[]) | undefined
    expect(
      updateMessages?.([{ id: 'u1', role: 'user', content: 'make slides' }]).at(-1)?.content,
    ).toBe(
      'I could not generate the deck yet. GPT-5.4 Mini is text-only and does not support attachments.',
    )
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

  it('ignores a stored job result after the recovery effect unmounts', async () => {
    const harness = makeHarness({ deckId: 'deck-1' })
    localStorage.setItem(`${STORAGE_PREFIX}deck-1`, 'job-stored')
    let resolveFetch: (job: GenerationJobApi) => void = () => {}
    fetchGenerationJobMock.mockImplementation(
      () =>
        new Promise<GenerationJobApi>((resolve) => {
          resolveFetch = resolve
        }),
    )

    const { unmount } = renderHook(() => useDeckGenerationFlow(harness.options))

    await waitFor(() => {
      expect(fetchGenerationJobMock).toHaveBeenCalledWith('job-stored')
    })
    unmount()

    await act(async () => {
      resolveFetch(makeJob({ id: 'job-stored', status: 'succeeded', result: succeededResult }))
      await Promise.resolve()
    })

    expect(harness.refreshActiveDeck).not.toHaveBeenCalled()
    expect(harness.reloadChat).not.toHaveBeenCalled()
  })
})
