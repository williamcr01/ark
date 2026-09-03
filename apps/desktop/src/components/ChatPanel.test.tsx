// @vitest-environment jsdom
import { type ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { exampleThemeProposal } from '@ark/chat/agent-themes.ts'
import { ChatPanel } from '@/components/ChatPanel'
import { ContextChipList } from '@/components/ChatContextChips'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WorkspaceRuntimeContext } from '@/hooks/workspace-runtime-context'
import { makeChatPanelRuntime, type ChatPanelHarness } from '@/test/chat-panel-harness'
import { useChatStore } from '@/state/chat-store.ts'

vi.mock('@/components/MiniHtmlPreview', () => ({
  MiniHtmlPreview: ({ title }: { title: string }) => (
    <div data-testid="mini-html-preview">{title}</div>
  ),
}))

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: (query: string) => query.includes('prefers-reduced-motion'),
}))

vi.mock('@/hooks/usePromptSubmit', async () => {
  const { chatPanelPromptMocks } = await import('@/test/chat-panel-harness')
  return {
    usePromptSubmit: () => ({
      handlePromptSubmit: (message: never) => chatPanelPromptMocks.handlePromptSubmit(message),
      sendQueuedNow: (id: string) => chatPanelPromptMocks.sendQueuedNow(id),
      sendQueuedAll: () => chatPanelPromptMocks.sendQueuedAll(),
      queuedSends: chatPanelPromptMocks.queuedSends,
      dismissQueuedSend: (id: string) => chatPanelPromptMocks.dismissQueuedSend(id),
      updateQueuedText: (id: string, text: string) =>
        chatPanelPromptMocks.updateQueuedText(id, text),
    }),
  }
})

vi.mock('@/hooks/useMcpInteraction', async () => {
  const { chatPanelMcpMocks } = await import('@/test/chat-panel-harness')
  return {
    useMcpInteraction: () => ({
      activeMcpInteraction: chatPanelMcpMocks.interaction,
      respondToMcpInteraction: chatPanelMcpMocks.submit,
      cancelMcpInteraction: chatPanelMcpMocks.cancel,
    }),
  }
})

const themeFonts = { display: 'georgia', body: 'calibri', mono: 'courier-new' } as const

const baseProps: ChatPanelHarness = {
  messages: [],
  input: '',
  generationStatus: null,
  activeSteps: [],
  failedJobId: null,
  error: '',
  attachmentError: '',
  models: [],
  selectedModel: '',
  reasoningEffort: 'medium',
  modelsError: '',
  modelWarnings: [],
  generationState: {
    canGenerate: true,
    isGenerating: false,
    isLoadingModels: false,
    showGenerationErrorAlert: true,
  },
  onPromptSubmit: vi.fn(),
  onCancelGeneration: vi.fn(),
  onRetryGeneration: vi.fn(),
}

function ChatPanelHarnessProvider({
  props = {},
  children,
}: {
  props?: ChatPanelHarness
  children: ReactNode
}) {
  const value = makeChatPanelRuntime(props)
  return (
    <MemoryRouter initialEntries={['/decks/deck-1']}>
      <WorkspaceRuntimeContext.Provider value={value}>
        <TooltipProvider>{children}</TooltipProvider>
      </WorkspaceRuntimeContext.Provider>
    </MemoryRouter>
  )
}

function renderChatPanel(props: ChatPanelHarness = {}) {
  const merged: ChatPanelHarness = {
    ...baseProps,
    ...props,
    generationState: { ...baseProps.generationState, ...props.generationState },
  }
  return render(
    <ChatPanelHarnessProvider props={merged}>
      <ChatPanel contextSlot={merged.contextSlot} layout={merged.layout} />
    </ChatPanelHarnessProvider>,
  )
}

describe('ChatPanel delivery status', () => {
  it('renders an unsynced indicator and retry affordance for failed messages', async () => {
    const onRetryPersist = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    renderChatPanel({
      getMessageDeliveryStatus: (messageId) => (messageId === 'm1' ? 'failed' : 'saved'),
      messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      onRetryPersist: onRetryPersist,
    })

    expect(screen.getByText('Not saved to server')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(onRetryPersist).toHaveBeenCalledWith('m1')
  })
})

describe('ChatPanel submit control', () => {
  it('renders an external MCP question without requiring an Ark model', async () => {
    const onMcpInteractionSubmit = vi.fn()
    const user = userEvent.setup()

    renderChatPanel({
      generationState: { ...baseProps.generationState, canGenerate: false },
      mcpInteraction: {
        id: '00000000-0000-4000-8000-000000000001',
        deckId: '00000000-0000-4000-8000-000000000002',
        baseDocumentRevision: 1,
        clientName: 'Codex',
        createdAt: '2026-08-06T12:00:00.000Z',
        expiresAt: '2026-08-06T12:30:00.000Z',
        kind: 'questions',
        request: {
          title: 'Shape the deck',
          questions: [
            {
              id: 'audience',
              question: 'Who is the audience?',
              type: 'single',
              options: ['Board', 'Customers'],
              required: true,
            },
          ],
        },
      },
      onMcpInteractionSubmit: onMcpInteractionSubmit,
    })

    expect(screen.getByText(/Codex is waiting for your response/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Board/ }))
    expect(onMcpInteractionSubmit).toHaveBeenCalledWith({
      kind: 'questions',
      answers: { audience: 'Board' },
    })
  })

  it('renders and submits visual themes requested through MCP', async () => {
    const onMcpInteractionSubmit = vi.fn()
    const user = userEvent.setup()
    const proposal = exampleThemeProposal('Pick a direction')
    const chosen = proposal.themes[2]!

    renderChatPanel({
      mcpInteraction: {
        id: '00000000-0000-4000-8000-000000000001',
        deckId: '00000000-0000-4000-8000-000000000002',
        baseDocumentRevision: 1,
        clientName: 'Claude Code',
        createdAt: '2026-08-06T12:00:00.000Z',
        expiresAt: '2026-08-06T12:30:00.000Z',
        kind: 'themes',
        request: proposal,
      },
      onMcpInteractionSubmit: onMcpInteractionSubmit,
    })

    await user.click(screen.getByRole('button', { name: `Select ${chosen.name}` }))
    await user.click(screen.getByRole('button', { name: `Use this theme: ${chosen.name}` }))
    expect(onMcpInteractionSubmit).toHaveBeenCalledWith({
      kind: 'themes',
      themeId: chosen.id,
      fonts: chosen.fonts,
      theme: chosen.theme,
    })
  })

  it(
    'renders ask_user questions one at a time above the composer',
    { timeout: 15_000 },
    async () => {
      const onQuestionSubmit = vi.fn()
      const user = userEvent.setup()

      renderChatPanel({
        messages: [
          { id: 'u1', role: 'user', content: 'Build a product launch deck' },
          {
            id: 'a1',
            role: 'assistant',
            content: 'Waiting for answers',
            parts: [
              {
                type: 'tool-call',
                toolName: 'ask_user',
                summary: '3 question(s)',
                input: {
                  title: 'Shape your presentation',
                  questions: [
                    {
                      id: 'audience',
                      question: 'Who is the audience?',
                      type: 'text',
                      placeholder: 'Investors…',
                    },
                    {
                      id: 'slide_count',
                      question: 'How many slides should it be?',
                      type: 'single',
                      options: ['5 slides', '8 slides', '10 slides'],
                    },
                    {
                      id: 'priorities',
                      question: 'What should the deck prioritize?',
                      type: 'multiple',
                      options: ['Concise', 'Story-led', 'Data-heavy'],
                    },
                  ],
                },
              },
            ],
          },
        ],
        onQuestionSubmit: onQuestionSubmit,
      })

      expect(screen.getByText('Who is the audience?')).toBeInTheDocument()
      expect(screen.queryByText('How many slides should it be?')).not.toBeInTheDocument()
      expect(screen.getByText('1 of 3')).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/Answer the questions above/i)).toBeDisabled()
      // Composer stays "active" (glow/ring) while ask_user is awaiting answers.
      const composer = screen
        .getByPlaceholderText(/Answer the questions above/i)
        .closest('[data-slot="agent-composer"]')
      expect(composer?.querySelector('.ring-1')).toBeTruthy()

      await user.type(screen.getByLabelText('Who is the audience?'), 'Customers')
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByText('How many slides should it be?')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /8 slides/i }))

      expect(screen.getByText('What should the deck prioritize?')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /Concise/i }))
      await user.click(screen.getByRole('button', { name: /Write your own/i }))
      await user.type(
        screen.getByLabelText(/Write your own answer for What should the deck prioritize/i),
        'Use bold product photography',
      )
      await user.click(screen.getByRole('button', { name: 'Send answers' }))

      expect(onQuestionSubmit).toHaveBeenCalledWith(expect.stringContaining('Customers'))
      expect(onQuestionSubmit).toHaveBeenCalledWith(expect.stringContaining('8 slides'))
      expect(onQuestionSubmit).toHaveBeenCalledWith(
        expect.stringContaining('Use bold product photography'),
      )
    },
  )

  it('does not show hardcoded intake without an ask_user tool call', () => {
    renderChatPanel({
      messages: [{ id: 'u1', role: 'user', content: 'Build a product launch deck' }],
      onQuestionSubmit: vi.fn(),
    })

    expect(screen.queryByText('Shape your presentation')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Describe the deck you want/i)).toBeEnabled()
  })

  it('renders propose_themes picker above the composer and submits a choice', async () => {
    const onQuestionSubmit = vi.fn()
    const user = userEvent.setup()
    const proposal = exampleThemeProposal()

    renderChatPanel({
      messages: [
        { id: 'u1', role: 'user', content: 'Build a product launch deck' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'Pick a direction',
          parts: [
            {
              type: 'tool-call',
              toolName: 'propose_themes',
              summary: '4 theme(s)',
              input: proposal,
            },
          ],
        },
      ],
      onQuestionSubmit: onQuestionSubmit,
    })

    expect(screen.getByText('Pick a visual direction')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Pick a theme above/i)).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Select Midnight Editorial' }))
    await user.click(screen.getByRole('button', { name: /Use this theme: Midnight Editorial/i }))

    expect(onQuestionSubmit).toHaveBeenCalledWith(
      expect.stringContaining('Midnight Editorial (id: midnight)'),
      expect.objectContaining({
        themeSelection: expect.objectContaining({ themeId: 'midnight' }),
      }),
    )
    expect(onQuestionSubmit).toHaveBeenCalledWith(
      expect.stringContaining('- Fonts: display georgia, body calibri, mono courier-new'),
      expect.anything(),
    )
  })

  it('keeps the composer active ring while the theme picker is pending', () => {
    const sampleHtml = `<!DOCTYPE html><html><body><section class="slide"><h1>Title</h1></section></body></html>`

    renderChatPanel({
      generationState: { ...baseProps.generationState, isGenerating: false },
      messages: [
        { id: 'u1', role: 'user', content: 'Build a product launch deck' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'Pick a direction',
          parts: [
            {
              type: 'tool-call',
              toolName: 'propose_themes',
              summary: '4 theme(s)',
              input: {
                title: 'Pick a visual direction',
                themes: [
                  {
                    id: 'midnight',
                    name: 'Midnight Editorial',
                    description: 'Dark and sharp',
                    fonts: themeFonts,
                    sampleHtml,
                  },
                  {
                    id: 'sunlit',
                    name: 'Sunlit Studio',
                    description: 'Warm and airy',
                    fonts: themeFonts,
                    sampleHtml,
                  },
                  {
                    id: 'signal',
                    name: 'Signal Grid',
                    description: 'Bold sans',
                    fonts: themeFonts,
                    sampleHtml,
                  },
                  {
                    id: 'folio',
                    name: 'Quiet Folio',
                    description: 'Soft paper',
                    fonts: themeFonts,
                    sampleHtml,
                  },
                ],
              },
            },
          ],
        },
      ],
      onQuestionSubmit: vi.fn(),
    })

    const textarea = screen.getByPlaceholderText(/Pick a theme above/i)
    expect(textarea.closest('.ring-1')).not.toBeNull()
  })

  it('folds theme choices under the propose_themes tool call instead of a user bubble', () => {
    const sampleHtml = `<!DOCTYPE html><html><body><section class="slide"><h1>Title</h1></section></body></html>`
    renderChatPanel({
      messages: [
        { id: 'u1', role: 'user', content: 'Build a product launch deck' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'Here are four directions.',
          parts: [
            {
              type: 'tool-call',
              toolName: 'propose_themes',
              summary: '4 theme(s)',
              input: {
                title: 'Pick a visual direction',
                themes: [
                  {
                    id: 'midnight',
                    name: 'Midnight Editorial',
                    description: 'Dark',
                    fonts: themeFonts,
                    sampleHtml,
                  },
                  {
                    id: 'sunlit',
                    name: 'Sunlit Studio',
                    description: 'Warm',
                    fonts: themeFonts,
                    sampleHtml,
                  },
                  {
                    id: 'signal',
                    name: 'Signal Grid',
                    description: 'Bold',
                    fonts: themeFonts,
                    sampleHtml,
                  },
                  {
                    id: 'folio',
                    name: 'Quiet Folio',
                    description: 'Soft',
                    fonts: themeFonts,
                    sampleHtml,
                  },
                ],
              },
            },
            {
              type: 'tool-result',
              toolName: 'propose_themes',
              summary: 'Waiting for theme choice',
            },
          ],
        },
        {
          id: 'u2',
          role: 'user',
          content:
            'Pick a visual direction: theme choice:\n- Theme: Midnight Editorial (id: midnight)',
        },
      ],
      onQuestionSubmit: vi.fn(),
    })

    expect(screen.getByText('Chose theme: Midnight Editorial')).toBeInTheDocument()
    expect(screen.queryByText(/Pick a visual direction: theme choice:/)).not.toBeInTheDocument()
    expect(
      screen.queryByText('Pick the visual direction for the first draft.'),
    ).not.toBeInTheDocument()
  })

  it('folds ask_user answers under the tool call instead of a user bubble', () => {
    renderChatPanel({
      messages: [
        { id: 'u1', role: 'user', content: 'Build a product launch deck' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'A couple of questions first.',
          parts: [
            {
              type: 'tool-call',
              toolName: 'ask_user',
              summary: '2 question(s)',
              input: {
                title: 'Shape your presentation',
                questions: [
                  {
                    id: 'audience',
                    question: 'Who is the audience?',
                    type: 'text',
                  },
                  {
                    id: 'length',
                    question: 'How many slides?',
                    type: 'single',
                    options: ['5 slides', '8 slides'],
                  },
                ],
              },
            },
            {
              type: 'tool-result',
              toolName: 'ask_user',
              summary: 'Waiting for user answers',
            },
          ],
        },
        {
          id: 'u2',
          role: 'user',
          content:
            'Shape your presentation: answers:\n- Who is the audience?: Customers\n- How many slides?: 8 slides',
        },
      ],
      onQuestionSubmit: vi.fn(),
    })

    expect(screen.getByText('Answered 2 questions')).toBeInTheDocument()
    expect(screen.getByText('Customers')).toBeInTheDocument()
    expect(screen.getByText('8 slides')).toBeInTheDocument()
    // Answer content must not appear as its own user bubble.
    expect(screen.queryByText(/Shape your presentation: answers:/)).not.toBeInTheDocument()
  })

  it('shows a concise working status while generating', () => {
    renderChatPanel({
      generationState: { ...baseProps.generationState, isGenerating: true },
      generationStatus: 'running',
    })

    expect(screen.getByText('Working…')).toBeInTheDocument()
    expect(
      screen
        .getByText('Listening')
        .closest('[role="status"]')
        ?.closest('[data-slot="agent-composer"]'),
    ).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Close agent panel' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Designing the deck/i)).not.toBeInTheDocument()
  })

  it('keeps submit disabled with no prompt or attachments', () => {
    renderChatPanel({
      input: '',
    })

    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  })

  it('keeps the textarea writable when generation is unavailable', () => {
    renderChatPanel({
      generationState: { ...baseProps.generationState, canGenerate: false },
      input: 'draft notes',
    })

    expect(screen.getByPlaceholderText(/Describe the deck/i)).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  })

  it('does not expose a refresh-models control', () => {
    renderChatPanel()

    expect(
      screen.queryByRole('button', { name: 'Refresh available models' }),
    ).not.toBeInTheDocument()
  })

  it('keeps a single add-attachments control next to the model picker', () => {
    renderChatPanel()

    expect(screen.getAllByRole('button', { name: 'Add attachments' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Upload deck assets' })).not.toBeInTheDocument()
  })

  it('renders slide context chips in the composer attachment row', () => {
    renderChatPanel({
      contextSlot: <span data-testid="context-chip">Slide 1 — Title</span>,
    })

    const chip = screen.getByTestId('context-chip')
    const composer = chip.closest('[data-slot="input-group"]')
    expect(composer).not.toBeNull()
    expect(composer).toContainElement(screen.getByPlaceholderText(/Describe the deck/i))
  })

  it('accepts all prompt attachments and revokes their blob URLs on unmount', async () => {
    const createObjectURL = vi.fn((file: File) => `blob:${file.name}`)
    const revokeObjectURL = vi.fn()
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    })
    const user = userEvent.setup()
    const { unmount } = renderChatPanel()
    const files = Array.from(
      { length: 6 },
      (_, index) => new File(['x'], `slide-${index}.png`, { type: 'image/png' }),
    )

    await user.upload(screen.getByLabelText('Upload files'), files)

    expect(createObjectURL).toHaveBeenCalledTimes(6)
    expect(useChatStore.getState().attachmentError).toBe('')
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()

    unmount()
    expect(revokeObjectURL).toHaveBeenCalledTimes(6)
  })

  it('arms an attachment before Backspace removes it', async () => {
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: vi.fn(() => 'blob:brief.pdf') },
      revokeObjectURL: { configurable: true, value: vi.fn() },
    })
    const user = userEvent.setup()
    renderChatPanel()

    await user.upload(
      screen.getByLabelText('Upload files'),
      new File(['brief'], 'brief.pdf', { type: 'application/pdf' }),
    )

    const textarea = screen.getByPlaceholderText(/Describe the deck/i)
    await user.click(textarea)
    await user.keyboard('{Backspace}')

    expect(screen.getByText('brief.pdf').closest('[data-attachment-id]')).toHaveAttribute(
      'data-armed',
      'true',
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'brief.pdf selected. Press Backspace again to remove it.',
    )

    await user.keyboard('{Backspace}')

    await waitFor(() => expect(screen.queryByText('brief.pdf')).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('brief.pdf removed.')
  })

  it('includes slide context in armed keyboard removal', async () => {
    const onRemoveSlide = vi.fn()
    const user = userEvent.setup()
    renderChatPanel({
      contextSlot: (
        <ContextChipList
          nested
          onRemoveSlide={onRemoveSlide}
          slides={[{ slideIndex: 2, title: 'Agenda' }]}
        />
      ),
    })

    const textarea = screen.getByPlaceholderText(/Describe the deck/i)
    await user.click(textarea)
    await user.keyboard('{Backspace}')

    expect(screen.getByText('Slide 3 — Agenda').closest('[data-attachment-id]')).toHaveAttribute(
      'data-armed',
      'true',
    )

    await user.keyboard('{Backspace}')

    expect(onRemoveSlide).toHaveBeenCalledWith(2)
  })

  it('disables attachments for text-only models', () => {
    renderChatPanel({
      models: [
        {
          id: 'openai:text-only-fixture',
          provider: 'openai',
          modelId: 'text-only-fixture',
          name: 'Text Only Fixture',
          available: true,
          reasoningEfforts: [],
          supportsAttachments: false,
        },
      ],
      selectedModel: 'openai:text-only-fixture',
    })

    expect(screen.getByRole('button', { name: 'Add attachments' })).toBeDisabled()
  })

  it('shows provider catalog warnings without blocking the chat', () => {
    renderChatPanel({
      generationState: { ...baseProps.generationState, canGenerate: true },
      modelWarnings: ['The Gemini API key in .env is invalid or expired.'],
    })

    expect(screen.getByText('Model catalog notice')).toBeInTheDocument()
    expect(
      screen.getByText('The Gemini API key in .env is invalid or expired.'),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Describe the deck/i)).toBeEnabled()
  })

  it('keeps model failures in the chat instead of showing a generation popup', () => {
    renderChatPanel({
      error: 'The provider rejected the request.',
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          content: 'The model failed to generate the deck. The provider rejected the request.',
        },
      ],
      generationState: { ...baseProps.generationState, showGenerationErrorAlert: false },
    })

    expect(screen.getByText(/The model failed to generate the deck/)).toBeInTheDocument()
    expect(screen.queryByText('Generation failed')).not.toBeInTheDocument()
  })

  it('keeps the generation popup for non-model errors', () => {
    renderChatPanel({
      error: 'The deck changed while generation was running.',
      generationState: { ...baseProps.generationState, showGenerationErrorAlert: true },
    })

    expect(screen.getByText('Generation failed')).toBeInTheDocument()
    expect(screen.getByText('The deck changed while generation was running.')).toBeInTheDocument()
  })

  it('dismisses floating agent warnings with the close button', async () => {
    const user = userEvent.setup()

    renderChatPanel({
      attachmentError: 'Each attachment must be 5 MB or smaller.',
    })

    expect(screen.getByText('Attachment error')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss Attachment error' }))
    expect(screen.queryByText('Attachment error')).not.toBeInTheDocument()
  })

  it('does not show API key required alerts', () => {
    renderChatPanel({
      generationState: { ...baseProps.generationState, canGenerate: false },
      models: [],
      selectedModel: '',
    })

    expect(screen.queryByText('API key required')).not.toBeInTheDocument()
    expect(screen.queryByText('No API key')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select model' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Select model' })).toHaveTextContent(
      'Add an API key in Settings',
    )
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  })

  it('keeps reasoning effort inside the model picker', () => {
    renderChatPanel({
      models: [
        {
          id: 'openai:gpt-5.6-luna',
          provider: 'openai',
          modelId: 'gpt-5.6-luna',
          name: 'GPT-5.6 Luna',
          available: true,
          reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          defaultReasoningEffort: 'medium',
          supportsAttachments: true,
        },
      ],
      reasoningEffort: 'high',
      selectedModel: 'openai:gpt-5.6-luna',
    })

    expect(
      screen.queryByRole('button', { name: 'Select reasoning effort' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select model' })).toHaveTextContent(
      'GPT-5.6 Luna · High',
    )
  })

  it('renders collapsible muted thinking parts', async () => {
    const user = userEvent.setup()

    renderChatPanel({
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          content: 'Updated the title.',
          parts: [
            { type: 'thinking', content: 'I will patch the title.', durationMs: 4200 },
            { type: 'text', content: 'Updated the title.' },
          ],
        },
      ],
    })

    const summary = screen.getByText('Thought for 4 seconds')
    expect(summary.closest('details')).not.toHaveAttribute('open')
    expect(screen.queryByText('I will patch the title.')).not.toBeVisible()

    await user.click(summary)
    expect(screen.getByText('I will patch the title.')).toBeVisible()
    expect(screen.getByText('I will patch the title.')).toHaveClass('text-muted-foreground/80')
  })

  it('labels finished thinking without a recorded duration as Thought', () => {
    renderChatPanel({
      messages: [
        {
          id: 'a1b',
          role: 'assistant',
          content: 'Updated the title.',
          parts: [
            { type: 'thinking', content: 'Thinking without timing metadata.' },
            { type: 'text', content: 'Updated the title.' },
          ],
        },
      ],
    })

    expect(screen.getByText('Thought')).toBeInTheDocument()
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument()
  })

  it('collapses consecutive tool calls into one unboxed text group', async () => {
    const user = userEvent.setup()

    renderChatPanel({
      messages: [
        {
          id: 'a2',
          role: 'assistant',
          content: 'Updated two slides.',
          parts: [
            { type: 'tool-call', toolName: 'read_deck', summary: 'Read slide 1' },
            { type: 'tool-result', toolName: 'read_deck', summary: 'Slide loaded' },
            { type: 'tool-call', toolName: 'patch_deck', summary: 'Updated slide 2' },
            { type: 'tool-result', toolName: 'patch_deck', summary: 'Patch applied' },
            { type: 'text', content: 'Updated two slides.' },
          ],
        },
      ],
    })

    const summary = screen.getByText('2 tool calls')
    const details = summary.closest('details')
    expect(details).not.toHaveAttribute('open')
    expect(details).not.toHaveClass('border')
    expect(screen.getByText(/Read slide 1/)).not.toBeVisible()

    await user.click(summary)
    expect(screen.getByText(/Read slide 1/)).toBeVisible()
    expect(screen.getByText(/Patch applied/)).toBeVisible()
  })

  it('collapses a single tool call by default', async () => {
    const user = userEvent.setup()

    renderChatPanel({
      messages: [
        {
          id: 'a3',
          role: 'assistant',
          content: 'Updated the title.',
          parts: [
            { type: 'tool-call', toolName: 'patch_deck', summary: 'Updated slide 1' },
            { type: 'tool-result', toolName: 'patch_deck', summary: 'Patch applied' },
            { type: 'text', content: 'Updated the title.' },
          ],
        },
      ],
    })

    const summary = screen.getByText('1 tool call')
    expect(summary.closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText(/Updated slide 1/)).not.toBeVisible()

    await user.click(summary)
    expect(screen.getByText(/Updated slide 1/)).toBeVisible()
  })

  it('keeps live generation thinking and tool calls collapsed', () => {
    renderChatPanel({
      activeSteps: [
        { type: 'thinking', summary: 'Planning the edit.' },
        { type: 'tool-call', toolName: 'read_deck', summary: 'Reading slide 1' },
      ],
      generationStatus: 'running',
      generationState: { ...baseProps.generationState, isGenerating: true },
    })

    expect(screen.getByText('Thinking').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText('1 tool call').closest('details')).not.toHaveAttribute('open')
    expect(screen.queryByText('Planning the edit.')).not.toBeVisible()
    expect(screen.queryByText(/Reading slide 1/)).not.toBeVisible()
  })

  it('labels finished live thinking with its duration', () => {
    renderChatPanel({
      activeSteps: [
        { type: 'thinking', summary: 'Planning the edit.', durationMs: 1100 },
        { type: 'tool-call', toolName: 'read_deck', summary: 'Reading slide 1' },
      ],
      generationStatus: 'running',
      generationState: { ...baseProps.generationState, isGenerating: true },
    })

    expect(screen.getByText('Thought for 1 second')).toBeInTheDocument()
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument()
  })

  it('keeps live assistant progress until the finalized job message is present', () => {
    const { unmount } = renderChatPanel({
      activeJobId: 'job-1',
      activeSteps: [{ type: 'thinking', summary: 'Planning the edit.', durationMs: 1100 }],
      generationStatus: 'succeeded',
      generationState: { ...baseProps.generationState, isGenerating: false },
      messages: [{ id: 'u1', role: 'user', content: 'make slides' }],
    })

    expect(screen.getByText('Thought for 1 second')).toBeInTheDocument()
    unmount()

    renderChatPanel({
      activeJobId: 'job-1',
      activeSteps: [{ type: 'thinking', summary: 'Planning the edit.', durationMs: 1100 }],
      generationStatus: 'succeeded',
      generationState: { ...baseProps.generationState, isGenerating: false },
      messages: [
        { id: 'u1', role: 'user', content: 'make slides' },
        {
          id: 'job-1',
          role: 'assistant',
          content: 'Updated the deck.',
          parts: [{ type: 'text', content: 'Updated the deck.' }],
        },
      ],
    })

    expect(screen.queryByText('Thought for 1 second')).not.toBeInTheDocument()
    expect(screen.getByText('Updated the deck.')).toBeInTheDocument()
  })
})

describe('ChatPanel send queue', () => {
  const queuedSends = [
    { id: 'q1', text: 'make it darker', attachmentCount: 0 },
    { id: 'q2', text: 'add a timeline', attachmentCount: 0 },
  ]

  it('submits immediately when idle', async () => {
    const onPromptSubmit = vi.fn()
    const user = userEvent.setup()

    renderChatPanel({
      input: 'make slides',
      onPromptSubmit: onPromptSubmit,
    })

    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onPromptSubmit).toHaveBeenCalled()
  })

  it('keeps the composer writable and Stop available while generating', async () => {
    const onPromptSubmit = vi.fn()
    const onCancelGeneration = vi.fn()
    const user = userEvent.setup()

    renderChatPanel({
      generationState: { ...baseProps.generationState, isGenerating: true },
      generationStatus: 'running',
      input: 'queue this',
      onCancelGeneration: onCancelGeneration,
      onPromptSubmit: onPromptSubmit,
    })

    expect(screen.getByPlaceholderText(/Queue a follow-up/i)).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onPromptSubmit).toHaveBeenCalled()
    expect(onCancelGeneration).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onCancelGeneration).toHaveBeenCalledTimes(1)
  })

  it.each(['sidebar', 'home'] as const)(
    'shows queued chips with Send now / Send all in the %s shell',
    async (layout) => {
      const onQueuedSendAll = vi.fn()
      const onQueuedSendDismiss = vi.fn()
      const onQueuedSendEdit = vi.fn()
      const onQueuedSendNow = vi.fn()
      const onCancelGeneration = vi.fn()
      const user = userEvent.setup()

      renderChatPanel({
        generationState: { ...baseProps.generationState, isGenerating: true },
        generationStatus: 'running',
        layout: layout,
        onCancelGeneration: onCancelGeneration,
        onQueuedSendAll: onQueuedSendAll,
        onQueuedSendDismiss: onQueuedSendDismiss,
        onQueuedSendEdit: onQueuedSendEdit,
        onQueuedSendNow: onQueuedSendNow,
        queuedSends: queuedSends,
      })

      expect(screen.getByText('2 queued messages')).toBeInTheDocument()
      expect(screen.getByText('make it darker')).toBeInTheDocument()
      expect(screen.getByText('add a timeline')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()

      await user.click(screen.getAllByRole('button', { name: 'Send now' })[0]!)
      expect(onQueuedSendNow).toHaveBeenCalledWith('q1')

      await user.click(screen.getByRole('button', { name: 'Send all' }))
      expect(onQueuedSendAll).toHaveBeenCalledTimes(1)

      await user.click(screen.getAllByRole('button', { name: 'Dismiss queued message' })[1]!)
      expect(onQueuedSendDismiss).toHaveBeenCalledWith('q2')

      await user.click(screen.getByRole('button', { name: 'make it darker' }))
      const editor = screen.getByRole('textbox', { name: 'Edit queued message' })
      await user.clear(editor)
      await user.type(editor, 'make it navy')
      await user.keyboard('{Enter}')
      expect(onQueuedSendEdit).toHaveBeenCalledWith('q1', 'make it navy')
    },
  )
})

describe('ChatTranscript', () => {
  it('renders live agent steps in the assistant transcript', () => {
    renderChatPanel({
      activeSteps: [
        { type: 'thinking', summary: 'Planning the edit.', durationMs: 1100 },
        { type: 'tool-call', toolName: 'read_deck', summary: 'Reading slide 1' },
      ],
      generationStatus: 'running',
      generationState: { ...baseProps.generationState, isGenerating: true },
    })

    expect(screen.getByText('Thought for 1 second')).toBeInTheDocument()
    expect(screen.getByText('1 tool call')).toBeInTheDocument()
  })
})

describe('ChatComposer', () => {
  it('submits when idle and keeps a queued follow-up visible while generating', async () => {
    const onPromptSubmit = vi.fn()
    const user = userEvent.setup()

    const { unmount } = renderChatPanel({
      input: 'make slides',
      onPromptSubmit,
    })
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onPromptSubmit).toHaveBeenCalled()
    unmount()

    renderChatPanel({
      generationState: { ...baseProps.generationState, isGenerating: true },
      generationStatus: 'running',
      queuedSends: [{ id: 'q1', text: 'then add a timeline', attachmentCount: 0 }],
    })
    expect(screen.getByText('1 queued message')).toBeInTheDocument()
    expect(screen.getByText('then add a timeline')).toBeInTheDocument()
  })
})

describe('ChatGenerationStatus', () => {
  it('shows working presence while generating', () => {
    renderChatPanel({
      generationState: { ...baseProps.generationState, isGenerating: true },
      generationStatus: 'running',
    })
    expect(screen.getByText('Working…')).toBeInTheDocument()
    expect(screen.getByText('Listening')).toBeInTheDocument()
  })

  it('shows a generation error banner', () => {
    renderChatPanel({
      error: 'The deck changed while generation was running.',
      generationState: { ...baseProps.generationState, showGenerationErrorAlert: true },
    })
    expect(screen.getByText('Generation failed')).toBeInTheDocument()
    expect(screen.getByText('The deck changed while generation was running.')).toBeInTheDocument()
  })
})
