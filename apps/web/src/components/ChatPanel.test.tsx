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
  isLoadingModels: false,
  modelsError: '',
  modelWarnings: [],
  canGenerate: true,
  onInputChange: vi.fn(),
  onModelChange: vi.fn(),
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

  it('does not show API key required alerts', () => {
    render(
      <TooltipProvider>
        <ChatPanel
          {...baseProps}
          canGenerate={false}
          models={[
            {
              id: 'openai:gpt-4o-mini',
              provider: 'openai',
              modelId: 'gpt-4o-mini',
              name: 'GPT-4o Mini',
              available: false,
              unavailableReason: 'missing_api_key',
            },
          ]}
          selectedModel="openai:gpt-4o-mini"
        />
      </TooltipProvider>,
    )

    expect(screen.queryByText('API key required')).not.toBeInTheDocument()
  })
})
