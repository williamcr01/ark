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
  apiKeyStatus: 'valid',
  canGenerate: true,
  onInputChange: vi.fn(),
  onModelChange: vi.fn(),
  onRefreshModels: vi.fn().mockResolvedValue(undefined),
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
})
