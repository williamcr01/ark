import { type ReactNode } from 'react'

import type { ChatPanelLayout } from '@/components/chat/chat-panel-runtime'
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input'
import type { ReasoningEffort } from '@/hooks/useReasoningEffort'
import type { WorkspaceRuntimeValue } from '@/hooks/workspace-runtime-context'
import type { QueuedChatSendPreview } from '@/lib/chat/chat-send-queue'
import { resetDesktopSettingsForTests } from '@/lib/ui/desktop-settings'
import { useChatStore, type MessageDeliveryStatus } from '@/state/chat-store.ts'
import { useModelsStore, type AvailableModel } from '@/state/models-store.ts'
import { useShellStore } from '@/state/shell-store.ts'
import type { AgentStep, ChatMessage } from '@ark/chat/messages.ts'
import type { ChatMessageContext } from '@ark/chat/context.ts'
import type { GenerationJobApi, GenerationJobStatus } from '@ark/contracts'
import type { McpInteractionAnswer, McpPendingInteraction } from '@ark/contracts'

export type ChatPanelHarness = {
  messages?: ChatMessage[]
  input?: string
  generationStatus?: GenerationJobStatus | null
  activeSteps?: AgentStep[]
  activeJobId?: string | null
  failedJobId?: string | null
  error?: string
  attachmentError?: string
  models?: AvailableModel[]
  selectedModel?: string
  reasoningEffort?: ReasoningEffort
  modelsError?: string
  modelWarnings?: string[]
  generationState?: {
    isGenerating?: boolean
    showGenerationErrorAlert?: boolean
    isLoadingModels?: boolean
    canGenerate?: boolean
  }
  interactiveToolsInModal?: boolean
  layout?: ChatPanelLayout
  contextSlot?: ReactNode
  queuedSends?: QueuedChatSendPreview[]
  onQueuedSendDismiss?: (id: string) => void
  onQueuedSendEdit?: (id: string, text: string) => void
  onQueuedSendNow?: (id: string) => void
  onQueuedSendAll?: () => void
  onPromptSubmit?: (message: PromptInputMessage) => void
  onQuestionSubmit?: (content: string, context?: ChatMessageContext) => void
  mcpInteraction?: McpPendingInteraction | null
  onMcpInteractionSubmit?: (answer: McpInteractionAnswer) => void
  onMcpInteractionCancel?: () => void
  onAttachmentError?: (message: string) => void
  onCancelGeneration?: () => void | Promise<void>
  onRetryGeneration?: () => void | Promise<void>
  getMessageDeliveryStatus?: (messageId: string) => MessageDeliveryStatus | undefined
  onRetryPersist?: (messageId: string) => void | Promise<void | boolean>
}

export const chatPanelPromptMocks = {
  handlePromptSubmit: ((() => undefined) as ChatPanelHarness['onPromptSubmit'])!,
  sendQueuedNow: ((() => undefined) as ChatPanelHarness['onQueuedSendNow'])!,
  sendQueuedAll: ((() => undefined) as ChatPanelHarness['onQueuedSendAll'])!,
  dismissQueuedSend: ((() => undefined) as ChatPanelHarness['onQueuedSendDismiss'])!,
  updateQueuedText: ((() => undefined) as ChatPanelHarness['onQueuedSendEdit'])!,
  queuedSends: [] as QueuedChatSendPreview[],
}

export const chatPanelMcpMocks = {
  interaction: null as McpPendingInteraction | null,
  submit: ((() => undefined) as ChatPanelHarness['onMcpInteractionSubmit'])!,
  cancel: ((() => undefined) as ChatPanelHarness['onMcpInteractionCancel'])!,
}

const defaultModel: AvailableModel = {
  id: 'test-model',
  provider: 'openai',
  modelId: 'test-model',
  name: 'Test',
  available: true,
  supportsAttachments: true,
  reasoningEfforts: [],
}

function stubJob(overrides: Partial<GenerationJobApi> = {}): GenerationJobApi {
  return {
    id: 'job-live',
    deckId: 'deck-1',
    baseDocumentRevision: null,
    editingExistingDeck: false,
    status: 'running',
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

export function applyChatPanelHarness(props: ChatPanelHarness = {}) {
  const generationState = {
    isGenerating: false,
    showGenerationErrorAlert: true,
    isLoadingModels: false,
    canGenerate: true,
    ...props.generationState,
  }
  const models = props.models ?? (generationState.canGenerate ? [defaultModel] : [])
  const selectedModel = props.selectedModel ?? models[0]?.id ?? ''
  const isModelFailure = generationState.showGenerationErrorAlert === false
  const error = props.error ?? ''
  const steps = props.activeSteps ?? []
  const status = props.generationStatus ?? null
  const activeJobId = props.activeJobId ?? null
  const needsJob =
    generationState.isGenerating || status != null || steps.length > 0 || activeJobId != null

  useChatStore.setState({
    messages: props.messages ?? [],
    input: props.input ?? '',
    attachmentError: props.attachmentError ?? '',
    workspaceError: isModelFailure ? '' : error,
    generationError: isModelFailure ? '' : error,
    isModelFailure,
    isGenerating: generationState.isGenerating,
    trackedDeckId: 'deck-1',
    messagesDeckId: 'deck-1',
    deliveryStatus: new Map(
      (props.messages ?? []).map((message) => [
        message.id,
        props.getMessageDeliveryStatus?.(message.id) ?? 'saved',
      ]),
    ),
    activeJob: needsJob
      ? stubJob({
          id: activeJobId ?? 'job-live',
          status: status ?? (generationState.isGenerating ? 'running' : 'succeeded'),
          progress: { steps, stepCount: steps.length, assistantText: null },
        })
      : null,
    failedJob: props.failedJobId ? stubJob({ id: props.failedJobId, status: 'failed' }) : null,
    queuedSends: (props.queuedSends ?? []).map((item) => ({
      id: item.id,
      text: item.text,
      attachments: Array.from({ length: item.attachmentCount }, (_, index) => ({
        type: 'file' as const,
        url: `queued://${item.id}/${index}`,
        mediaType: 'text/plain',
        filename: `file-${index}`,
      })),
      assetIds: [],
    })),
  })

  useModelsStore.setState({
    models,
    error: props.modelsError ?? '',
    warnings: props.modelWarnings ?? [],
    isLoading: generationState.isLoadingModels,
  })

  resetDesktopSettingsForTests({
    agentInteractionsInModal: props.interactiveToolsInModal ?? false,
    reasoningEffortByModel: props.reasoningEffort ? { [selectedModel]: props.reasoningEffort } : {},
    selectedModel: selectedModel || null,
  })

  useShellStore.setState({
    selectedModel,
    agentInteractionsInModal: props.interactiveToolsInModal ?? false,
    reasoningEffortByModel: props.reasoningEffort ? { [selectedModel]: props.reasoningEffort } : {},
  })

  chatPanelPromptMocks.handlePromptSubmit = props.onPromptSubmit ?? (() => undefined)
  chatPanelPromptMocks.sendQueuedNow = props.onQueuedSendNow ?? (() => undefined)
  chatPanelPromptMocks.sendQueuedAll = props.onQueuedSendAll ?? (() => undefined)
  chatPanelPromptMocks.dismissQueuedSend = props.onQueuedSendDismiss ?? (() => undefined)
  chatPanelPromptMocks.updateQueuedText = props.onQueuedSendEdit ?? (() => undefined)
  chatPanelPromptMocks.queuedSends = props.queuedSends ?? []
  chatPanelMcpMocks.interaction = props.mcpInteraction ?? null
  chatPanelMcpMocks.submit = props.onMcpInteractionSubmit ?? (() => undefined)
  chatPanelMcpMocks.cancel = props.onMcpInteractionCancel ?? (() => undefined)

  return { generationState, models, selectedModel }
}

export function makeChatPanelRuntime(props: ChatPanelHarness = {}): WorkspaceRuntimeValue {
  const { generationState, models, selectedModel } = applyChatPanelHarness(props)
  const onQuestionSubmit = props.onQuestionSubmit

  return {
    persistence: {
      deckId: 'deck-1',
    },
    chat: {
      retryPersist: props.onRetryPersist ?? (() => undefined),
      getMessageDeliveryStatus: props.getMessageDeliveryStatus ?? (() => 'saved'),
    },
    generation: {
      generateDeck: async (
        content: string,
        _attachments?: unknown,
        options?: { themeSelection?: ChatMessageContext['themeSelection'] },
      ) => {
        if (options?.themeSelection) {
          onQuestionSubmit?.(content, { themeSelection: options.themeSelection })
        } else {
          onQuestionSubmit?.(content)
        }
      },
      cancelGeneration: props.onCancelGeneration ?? (() => undefined),
      retryGeneration: props.onRetryGeneration ?? (() => undefined),
      isGenerating: generationState.isGenerating,
    },
    models: {
      canGenerate: generationState.canGenerate,
      setSelectedModel: useShellStore.getState().setSelectedModel,
      models,
      selectedModel,
      isLoading: generationState.isLoadingModels,
      error: props.modelsError ?? '',
      warnings: props.modelWarnings ?? [],
    },
  } as unknown as WorkspaceRuntimeValue
}
