import { type ReactNode, useState } from 'react'
import { AlertCircleIcon, RefreshCwIcon, XIcon } from 'lucide-react'

import { AgentPresence } from '@/components/AgentPresence'
import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import { useChatPanelRuntime } from '@/components/chat/chat-panel-runtime'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  selectActiveSteps,
  selectFailedJobId,
  selectGenerationStatus,
  useChatStore,
} from '@/state/chat-store.ts'
import { useModelsStore } from '@/state/models-store.ts'

type ChatAlertId = 'generation' | 'attachment' | 'models' | 'model-warnings'

function alertDismissKey(alertId: ChatAlertId, content: string) {
  return `${alertId}:${content}`
}

function ChatFloatingAlert({
  title,
  variant = 'default',
  onClose,
  children,
}: {
  title: string
  variant?: 'default' | 'destructive'
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Alert variant={variant}>
      <AlertCircleIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
      <AlertAction>
        <Button aria-label={`Dismiss ${title}`} onClick={onClose} size="icon-xs" variant="ghost">
          <XIcon />
        </Button>
      </AlertAction>
    </Alert>
  )
}

function ChatMcpWaitingBanner() {
  const { mcp } = useChatPanelRuntime()
  const mcpInteraction = mcp.activeMcpInteraction
  if (!mcpInteraction) {
    return null
  }

  return (
    <div className="mb-3 flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
      <span>
        {mcpInteraction.clientName ?? 'An external agent'} is waiting for your response through MCP.
      </span>
      <Button
        onClick={() => {
          void mcp.cancelMcpInteraction()
        }}
        size="sm"
        type="button"
        variant="ghost"
      >
        Cancel
      </Button>
    </div>
  )
}

function visibleChatAlerts(input: {
  attachmentError: string
  dismissedAlertKeys: Set<string>
  error: string
  isModelFailure: boolean
  modelWarnings: string[]
  modelsError: string
}) {
  const isDismissed = (alertId: ChatAlertId, content: string) =>
    input.dismissedAlertKeys.has(alertDismissKey(alertId, content))
  const modelWarningsKey = input.modelWarnings.join('\n')
  return {
    modelWarningsKey,
    showAttachmentError:
      Boolean(input.attachmentError) && !isDismissed('attachment', input.attachmentError),
    showGenerationError:
      !input.isModelFailure && Boolean(input.error) && !isDismissed('generation', input.error),
    showModelWarnings:
      input.modelWarnings.length > 0 && !isDismissed('model-warnings', modelWarningsKey),
    showModelsError: Boolean(input.modelsError) && !isDismissed('models', input.modelsError),
  }
}

function ChatStatusAlerts() {
  const { retryGeneration } = useChatPanelRuntime()
  const workspaceError = useChatStore((state) => state.workspaceError)
  const generationError = useChatStore((state) => state.generationError)
  const isModelFailure = useChatStore((state) => state.isModelFailure)
  const attachmentError = useChatStore((state) => state.attachmentError)
  const failedJobId = useChatStore(selectFailedJobId)
  const modelsError = useModelsStore((state) => state.error)
  const modelWarnings = useModelsStore((state) => state.warnings)
  const [dismissedAlertKeys, setDismissedAlertKeys] = useState<Set<string>>(() => new Set())
  const error = workspaceError || (isModelFailure ? '' : generationError)
  const {
    modelWarningsKey,
    showAttachmentError,
    showGenerationError,
    showModelWarnings,
    showModelsError,
  } = visibleChatAlerts({
    attachmentError,
    dismissedAlertKeys,
    error,
    isModelFailure,
    modelWarnings,
    modelsError,
  })

  const dismissAlert = (alertId: ChatAlertId, content: string) => {
    setDismissedAlertKeys((current) => new Set(current).add(alertDismissKey(alertId, content)))
  }

  if (!showGenerationError && !showAttachmentError && !showModelsError && !showModelWarnings) {
    return null
  }

  return (
    <div className="absolute inset-x-4 bottom-full z-10 mb-2 flex flex-col gap-2">
      {showGenerationError ? (
        <ChatFloatingAlert
          onClose={() => dismissAlert('generation', error)}
          title="Generation failed"
          variant="destructive"
        >
          <div className="flex flex-col gap-2">
            <span>{error}</span>
            {failedJobId ? (
              <div>
                <PromptInputButton
                  aria-label="Retry generation"
                  onClick={() => {
                    dismissAlert('generation', error)
                    void retryGeneration()
                  }}
                  tooltip="Retry generation"
                >
                  <RefreshCwIcon className="size-4" />
                  Retry
                </PromptInputButton>
              </div>
            ) : null}
          </div>
        </ChatFloatingAlert>
      ) : null}
      {showAttachmentError ? (
        <ChatFloatingAlert
          onClose={() => dismissAlert('attachment', attachmentError)}
          title="Attachment error"
          variant="destructive"
        >
          {attachmentError}
        </ChatFloatingAlert>
      ) : null}
      {showModelsError ? (
        <ChatFloatingAlert
          onClose={() => dismissAlert('models', modelsError)}
          title="Could not load models"
          variant="destructive"
        >
          {modelsError}
        </ChatFloatingAlert>
      ) : null}
      {showModelWarnings ? (
        <ChatFloatingAlert
          onClose={() => dismissAlert('model-warnings', modelWarningsKey)}
          title="Model catalog notice"
        >
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {modelWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </ChatFloatingAlert>
      ) : null}
    </div>
  )
}

export function ChatGenerationStatus() {
  const { reducedMotion, resolvedAppearance } = useChatPanelRuntime()
  const isGenerating = useChatStore((state) => state.isGenerating)
  const activeSteps = useChatStore(selectActiveSteps)
  const generationStatus = useChatStore(selectGenerationStatus)

  return (
    <>
      {isGenerating ? (
        <div className="mb-2 flex min-h-5 items-center px-1">
          <AgentPresence
            activeSteps={activeSteps}
            generationStatus={generationStatus}
            reducedMotion={reducedMotion}
            resolvedAppearance={resolvedAppearance}
          />
        </div>
      ) : null}
      <ChatMcpWaitingBanner />
      <ChatStatusAlerts />
    </>
  )
}
