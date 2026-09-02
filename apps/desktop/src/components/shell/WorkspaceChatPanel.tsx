import { ChatPanel } from '@/components/ChatPanel'
import { useAppearance } from '@/hooks/useAppearance'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useReasoningEffort, type ReasoningEffort } from '@/hooks/useReasoningEffort'
import type { UsePromptSubmitResult } from '@/hooks/usePromptSubmit'
import { useWorkspaceRuntimeContext } from '@/hooks/workspace-runtime-context'
import { useChatStore } from '@/state/chat-store.ts'
import { useShellStore } from '@/state/shell-store.ts'
import type { ReactNode } from 'react'
import { useCallback } from 'react'

type WorkspaceChatPanelProps = {
  layout: 'home' | 'sidebar'
  prompt: UsePromptSubmitResult
  contextSlot?: ReactNode
}

export function WorkspaceChatPanel({
  layout,
  prompt,
  contextSlot = null,
}: WorkspaceChatPanelProps) {
  const { chat, generation, models } = useWorkspaceRuntimeContext()
  const { resolvedAppearance } = useAppearance()
  const { getReasoningEffort, reasoningEffort, setReasoningEffort } = useReasoningEffort(
    models.selectedModel,
    models.models,
  )
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const input = useChatStore((state) => state.input)
  const setInput = useChatStore((state) => state.setInput)
  const attachmentError = useChatStore((state) => state.attachmentError)
  const setAttachmentError = useChatStore((state) => state.setAttachmentError)
  const workspaceError = useChatStore((state) => state.workspaceError)
  const agentInteractionsInModal = useShellStore((state) => state.agentInteractionsInModal)
  const displayError = workspaceError || generation.generationError

  const handleModelSelect = useCallback(
    (modelId: string, nextEffort?: ReasoningEffort) => {
      models.setSelectedModel(modelId)
      if (nextEffort) {
        setReasoningEffort(nextEffort, modelId)
      }
    },
    [models, setReasoningEffort],
  )

  return (
    <ChatPanel
      activeJobId={generation.activeJobId}
      activeSteps={generation.activeSteps}
      attachmentError={attachmentError}
      contextSlot={contextSlot}
      error={displayError}
      failedJobId={generation.failedJobId}
      generationState={{
        canGenerate: models.canGenerate,
        isGenerating: generation.isGenerating,
        isLoadingModels: models.isLoading,
        showGenerationErrorAlert: !generation.isModelFailure,
      }}
      generationStatus={generation.generationStatus}
      getMessageDeliveryStatus={chat.getMessageDeliveryStatus}
      getReasoningEffort={getReasoningEffort}
      input={input}
      interactiveToolsInModal={agentInteractionsInModal && layout !== 'home'}
      layout={layout}
      messages={chat.messages}
      models={models.models}
      modelsError={models.error}
      modelWarnings={models.warnings}
      onAttachmentError={setAttachmentError}
      onCancelGeneration={generation.cancelGeneration}
      onInputChange={setInput}
      onModelSelect={handleModelSelect}
      onPromptSubmit={prompt.handlePromptSubmit}
      onQueuedSendAll={prompt.sendQueuedAll}
      onQueuedSendDismiss={prompt.dismissQueuedSend}
      onQueuedSendEdit={prompt.updateQueuedText}
      onQueuedSendNow={prompt.sendQueuedNow}
      queuedSends={prompt.queuedSends}
      onQuestionSubmit={(content, context) => {
        void generation.generateDeck(content, [], {
          themeSelection: context?.themeSelection,
        })
      }}
      onRetryGeneration={generation.retryGeneration}
      onRetryPersist={chat.retryPersist}
      reducedMotion={reducedMotion}
      reasoningEffort={reasoningEffort}
      resolvedAppearance={resolvedAppearance}
      selectedModel={models.selectedModel}
    />
  )
}
