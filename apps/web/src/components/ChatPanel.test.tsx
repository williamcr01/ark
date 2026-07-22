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

  it('disables attachments for text-only models', () => {
    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          models={[
            {
              id: 'openai:gpt-5.3-codex-spark',
              provider: 'openai',
              modelId: 'gpt-5.3-codex-spark',
              name: 'Code 5.3 Spark',
              available: true,
              reasoningEfforts: [],
              supportsReasoning: false,
              supportsAttachments: false,
            },
          ]}
          selectedModel="openai:gpt-5.3-codex-spark"
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
                { type: 'thinking', content: 'I will patch the title.' },
                { type: 'text', content: 'Updated the title.' },
              ],
            },
          ]}
        />
      </TooltipProvider>,
    )

    const summary = screen.getByText('Thinking')
    expect(summary.closest('details')).not.toHaveAttribute('open')
    expect(screen.queryByText('I will patch the title.')).not.toBeVisible()

    await user.click(summary)
    expect(screen.getByText('I will patch the title.')).toBeVisible()
    expect(screen.getByText('I will patch the title.')).toHaveClass('text-muted-foreground/80')
  })
})
