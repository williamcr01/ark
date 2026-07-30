import { type ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ChatPanel } from '@/components/ChatPanel'
import { TooltipProvider } from '@/components/ui/tooltip'

const baseProps: ComponentProps<typeof ChatPanel> = {
  messages: [],
  input: '',
  isGenerating: false,
  generationStatus: null,
  activeSteps: [],
  failedJobId: null,
  error: '',
  attachmentError: '',
  models: [],
  selectedModel: '',
  reasoningEffort: 'medium',
  isLoadingModels: false,
  modelsError: '',
  modelWarnings: [],
  canGenerate: true,
  // Avoid mounting border-beam in jsdom (it requires matchMedia).
  reducedMotion: true,
  onInputChange: vi.fn(),
  onModelSelect: vi.fn(),
  onPromptSubmit: vi.fn(),
  onAttachmentError: vi.fn(),
  onCancelGeneration: vi.fn(),
  onRetryGeneration: vi.fn(),
}

describe('ChatPanel delivery status', () => {
  it('renders an unsynced indicator and retry affordance for failed messages', async () => {
    const onRetryPersist = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          getMessageDeliveryStatus={(messageId) => (messageId === 'm1' ? 'failed' : 'saved')}
          messages={[{ id: 'm1', role: 'user', content: 'hello' }]}
          onRetryPersist={onRetryPersist}
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('Not saved to server')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(onRetryPersist).toHaveBeenCalledWith('m1')
  })
})

describe('ChatPanel submit control', () => {
  it('renders ask_user questions one at a time above the composer', async () => {
    const onQuestionSubmit = vi.fn()
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          messages={[
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
          ]}
          onQuestionSubmit={onQuestionSubmit}
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('Who is the audience?')).toBeInTheDocument()
    expect(screen.queryByText('How many slides should it be?')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Answer the questions above/i)).toBeDisabled()

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
  })

  it('does not show hardcoded intake without an ask_user tool call', () => {
    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          messages={[{ id: 'u1', role: 'user', content: 'Build a product launch deck' }]}
          onQuestionSubmit={vi.fn()}
        />
      </TooltipProvider>,
    )

    expect(screen.queryByText('Shape your presentation')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Describe the deck you want/i)).toBeEnabled()
  })

  it('folds ask_user answers under the tool call instead of a user bubble', () => {
    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          messages={[
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
                'Shape your presentation — answers:\n- Who is the audience?: Customers\n- How many slides?: 8 slides',
            },
          ]}
          onQuestionSubmit={vi.fn()}
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('Answered 2 questions')).toBeInTheDocument()
    expect(screen.getByText('Customers')).toBeInTheDocument()
    expect(screen.getByText('8 slides')).toBeInTheDocument()
    // Answer content must not appear as its own user bubble.
    expect(screen.queryByText(/Shape your presentation — answers:/)).not.toBeInTheDocument()
  })

  it('shows a concise working status while generating', () => {
    render(
      <TooltipProvider>
        <ChatPanel {...baseProps} generationStatus="running" isGenerating />
      </TooltipProvider>,
    )

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

  it('enables submit when only deck assets are selected', () => {
    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          input=""
          selectedAssetIds={['00000000-0000-4000-8000-000000000001']}
        />
      </TooltipProvider>,
    )

    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()
  })

  it('keeps submit disabled with no prompt, attachments, or selected assets', () => {
    render(
      <TooltipProvider>
        <ChatPanel {...baseProps} input="" selectedAssetIds={[]} />
      </TooltipProvider>,
    )

    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  })

  it('keeps the textarea writable when generation is unavailable', () => {
    render(
      <TooltipProvider>
        <ChatPanel {...baseProps} canGenerate={false} input="draft notes" />
      </TooltipProvider>,
    )

    expect(screen.getByPlaceholderText(/Describe the deck/i)).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  })

  it('does not expose a refresh-models control', () => {
    render(
      <TooltipProvider>
        <ChatPanel {...baseProps} />
      </TooltipProvider>,
    )

    expect(
      screen.queryByRole('button', { name: 'Refresh available models' }),
    ).not.toBeInTheDocument()
  })

  it('keeps a single add-attachments control next to the model picker', () => {
    render(
      <TooltipProvider>
        <ChatPanel {...baseProps} />
      </TooltipProvider>,
    )

    expect(screen.getAllByRole('button', { name: 'Add attachments' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Upload deck assets' })).not.toBeInTheDocument()
  })

  it('renders slide context chips in the composer attachment row', () => {
    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          contextSlot={<span data-testid="context-chip">Slide 1 — Title</span>}
        />
      </TooltipProvider>,
    )

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
    const onAttachmentError = vi.fn()
    const user = userEvent.setup()
    const { unmount } = render(
      <TooltipProvider>
        <ChatPanel {...baseProps} onAttachmentError={onAttachmentError} selectedAssetIds={[]} />
      </TooltipProvider>,
    )
    const files = Array.from(
      { length: 6 },
      (_, index) => new File(['x'], `slide-${index}.png`, { type: 'image/png' }),
    )

    await user.upload(screen.getByLabelText('Upload files'), files)

    expect(createObjectURL).toHaveBeenCalledTimes(6)
    expect(onAttachmentError).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()

    unmount()
    expect(revokeObjectURL).toHaveBeenCalledTimes(6)
  })

  it('disables attachments for text-only models', () => {
    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          models={[
            {
              id: 'openai:text-only-fixture',
              provider: 'openai',
              modelId: 'text-only-fixture',
              name: 'Text Only Fixture',
              available: true,
              reasoningEfforts: [],
              supportsReasoning: false,
              supportsAttachments: false,
            },
          ]}
          selectedModel="openai:text-only-fixture"
        />
      </TooltipProvider>,
    )

    expect(screen.getByRole('button', { name: 'Add attachments' })).toBeDisabled()
  })

  it('shows provider catalog warnings without blocking the chat', () => {
    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          canGenerate
          modelWarnings={['The Gemini API key in .env is invalid or expired.']}
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('Model catalog notice')).toBeInTheDocument()
    expect(
      screen.getByText('The Gemini API key in .env is invalid or expired.'),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Describe the deck/i)).toBeEnabled()
  })

  it('keeps model failures in the chat instead of showing a generation popup', () => {
    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          error="The provider rejected the request."
          messages={[
            {
              id: 'a1',
              role: 'assistant',
              content: 'The model failed to generate the deck. The provider rejected the request.',
            },
          ]}
          showGenerationErrorAlert={false}
        />
      </TooltipProvider>,
    )

    expect(screen.getByText(/The model failed to generate the deck/)).toBeInTheDocument()
    expect(screen.queryByText('Generation failed')).not.toBeInTheDocument()
  })

  it('keeps the generation popup for non-model errors', () => {
    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          error="The deck changed while generation was running."
          showGenerationErrorAlert
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('Generation failed')).toBeInTheDocument()
    expect(screen.getByText('The deck changed while generation was running.')).toBeInTheDocument()
  })

  it('dismisses floating agent warnings with the close button', async () => {
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <ChatPanel {...baseProps} attachmentError="Each attachment must be 5 MB or smaller." />
      </TooltipProvider>,
    )

    expect(screen.getByText('Attachment error')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss Attachment error' }))
    expect(screen.queryByText('Attachment error')).not.toBeInTheDocument()
  })

  it('does not show API key required alerts', () => {
    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          canGenerate={false}
          models={[
            {
              id: 'openai:gpt-5.6-luna',
              provider: 'openai',
              modelId: 'gpt-5.6-luna',
              name: 'GPT-5.6 Luna',
              available: false,
              unavailableReason: 'missing_api_key',
              reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
              defaultReasoningEffort: 'medium',
              supportsReasoning: true,
            },
          ]}
          selectedModel="openai:gpt-5.6-luna"
        />
      </TooltipProvider>,
    )

    expect(screen.queryByText('API key required')).not.toBeInTheDocument()
  })

  it('keeps reasoning effort inside the model picker', () => {
    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          models={[
            {
              id: 'openai:gpt-5.6-luna',
              provider: 'openai',
              modelId: 'gpt-5.6-luna',
              name: 'GPT-5.6 Luna',
              available: true,
              reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
              defaultReasoningEffort: 'medium',
              supportsReasoning: true,
            },
          ]}
          reasoningEffort="high"
          selectedModel="openai:gpt-5.6-luna"
        />
      </TooltipProvider>,
    )

    expect(
      screen.queryByRole('button', { name: 'Select reasoning effort' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select model' })).toHaveTextContent(
      'GPT-5.6 Luna · High',
    )
  })

  it('renders collapsible muted thinking parts', async () => {
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          messages={[
            {
              id: 'a1',
              role: 'assistant',
              content: 'Updated the title.',
              parts: [
                { type: 'thinking', content: 'I will patch the title.', durationMs: 4200 },
                { type: 'text', content: 'Updated the title.' },
              ],
            },
          ]}
        />
      </TooltipProvider>,
    )

    const summary = screen.getByText('Thought for 4 seconds')
    expect(summary.closest('details')).not.toHaveAttribute('open')
    expect(screen.queryByText('I will patch the title.')).not.toBeVisible()

    await user.click(summary)
    expect(screen.getByText('I will patch the title.')).toBeVisible()
    expect(screen.getByText('I will patch the title.')).toHaveClass('text-muted-foreground/80')
  })

  it('labels finished thinking without a recorded duration as Thought', () => {
    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          messages={[
            {
              id: 'a1b',
              role: 'assistant',
              content: 'Updated the title.',
              parts: [
                { type: 'thinking', content: 'Legacy thinking without timing.' },
                { type: 'text', content: 'Updated the title.' },
              ],
            },
          ]}
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('Thought')).toBeInTheDocument()
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument()
  })

  it('collapses consecutive tool calls into one unboxed text group', async () => {
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          messages={[
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
          ]}
        />
      </TooltipProvider>,
    )

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

    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          messages={[
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
          ]}
        />
      </TooltipProvider>,
    )

    const summary = screen.getByText('1 tool call')
    expect(summary.closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText(/Updated slide 1/)).not.toBeVisible()

    await user.click(summary)
    expect(screen.getByText(/Updated slide 1/)).toBeVisible()
  })

  it('keeps live generation thinking and tool calls collapsed', () => {
    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          activeSteps={[
            { type: 'thinking', summary: 'Planning the edit.' },
            { type: 'tool-call', toolName: 'read_deck', summary: 'Reading slide 1' },
          ]}
          generationStatus="running"
          isGenerating
          reducedMotion
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('Thinking').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText('1 tool call').closest('details')).not.toHaveAttribute('open')
    expect(screen.queryByText('Planning the edit.')).not.toBeVisible()
    expect(screen.queryByText(/Reading slide 1/)).not.toBeVisible()
  })

  it('labels finished live thinking with its duration', () => {
    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          activeSteps={[
            { type: 'thinking', summary: 'Planning the edit.', durationMs: 1100 },
            { type: 'tool-call', toolName: 'read_deck', summary: 'Reading slide 1' },
          ]}
          generationStatus="running"
          isGenerating
          reducedMotion
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('Thought for 1 second')).toBeInTheDocument()
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument()
  })

  it('keeps live assistant progress until the finalized job message is present', () => {
    const { rerender } = render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          activeJobId="job-1"
          activeSteps={[{ type: 'thinking', summary: 'Planning the edit.', durationMs: 1100 }]}
          generationStatus="succeeded"
          isGenerating={false}
          messages={[{ id: 'u1', role: 'user', content: 'make slides' }]}
          reducedMotion
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('Thought for 1 second')).toBeInTheDocument()

    rerender(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          activeJobId="job-1"
          activeSteps={[{ type: 'thinking', summary: 'Planning the edit.', durationMs: 1100 }]}
          generationStatus="succeeded"
          isGenerating={false}
          messages={[
            { id: 'u1', role: 'user', content: 'make slides' },
            {
              id: 'job-1',
              role: 'assistant',
              content: 'Updated the deck.',
              parts: [{ type: 'text', content: 'Updated the deck.' }],
            },
          ]}
          reducedMotion
        />
      </TooltipProvider>,
    )

    expect(screen.queryByText('Thought for 1 second')).not.toBeInTheDocument()
    expect(screen.getByText('Updated the deck.')).toBeInTheDocument()
  })
})
