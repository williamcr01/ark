import {
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
  useState,
} from 'react'
import type { BorderBeamProps } from 'border-beam'
import { PlusIcon } from 'lucide-react'

import {
  Attachment,
  AttachmentInfo,
  AttachmentPresence,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@/components/ai-elements/attachments'
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input'
import { useChatInteractionLock } from '@/components/chat/chat-interaction-lock'
import { useChatPanelRuntime } from '@/components/chat/chat-panel-runtime'
import { ModelSelector } from '@/components/ModelSelector'
import {
  MorphMenuContent,
  MorphMenuFooter,
  morphMenuTriggerClassName,
} from '@/components/ui/morph-menu'
import type { ResolvedAppearance } from '@/hooks/useAppearance'
import { useReasoningEffort, type ReasoningEffort } from '@/hooks/useReasoningEffort'
import { formatAttachmentError } from '@/lib/chat/chat-attachment-error'
import { cn } from '@/lib/ui/utils'
import { useChatStore } from '@/state/chat-store.ts'
import { useModelsStore } from '@/state/models-store.ts'
import { useShellStore } from '@/state/shell-store.ts'
import { MAX_CHAT_ATTACHMENT_BYTES } from '@ark/chat/chat.ts'

const BorderBeam = lazy(() => import('border-beam')) as LazyExoticComponent<
  ComponentType<BorderBeamProps>
>

const ARK_RADIUS_LG = 10

function ActiveComposer({
  active,
  reducedMotion,
  resolvedAppearance,
  children,
}: {
  active: boolean
  reducedMotion: boolean
  resolvedAppearance: ResolvedAppearance
  children: ReactNode
}) {
  const focusRingClassName =
    'rounded-lg has-[textarea:focus]:ring-1 has-[textarea:focus]:ring-[var(--ark-fill)]'
  const ringClassName = cn(
    focusRingClassName,
    active && 'rounded-lg ring-1 ring-[var(--ark-focus)]',
  )

  if (reducedMotion) {
    return <div className={ringClassName}>{children}</div>
  }

  return (
    <Suspense fallback={<div className={ringClassName}>{children}</div>}>
      <BorderBeam
        active={active}
        borderRadius={ARK_RADIUS_LG}
        className={focusRingClassName}
        colorVariant="colorful"
        duration={3.1}
        size="md"
        strength={1}
        theme={resolvedAppearance}
      >
        {children}
      </BorderBeam>
    </Suspense>
  )
}

function PromptInputAttachmentsDisplay({ children }: { children?: ReactNode }) {
  const attachments = usePromptInputAttachments()
  const hasFiles = attachments.files.length > 0

  if (!hasFiles && !children) {
    return null
  }

  return (
    <PromptInputHeader>
      <Attachments variant="inline">
        <AttachmentPresence>
          {attachments.files.map((attachment) => (
            <Attachment
              data={attachment}
              key={attachment.id}
              onRemove={() => attachments.remove(attachment.id)}
            >
              <AttachmentPreview />
              <AttachmentInfo />
              <AttachmentRemove />
            </Attachment>
          ))}
        </AttachmentPresence>
        {children}
      </Attachments>
    </PromptInputHeader>
  )
}

function ChatPromptInputSubmit({
  input,
  isGenerating,
  isInputDisabled,
  onCancelGeneration,
}: {
  input: string
  isGenerating: boolean
  isInputDisabled: boolean
  onCancelGeneration: () => void | Promise<void>
}) {
  const attachments = usePromptInputAttachments()
  const canSubmit = Boolean(input.trim() || attachments.files.length > 0)

  return (
    <div className="flex shrink-0 items-center gap-1">
      {isGenerating ? (
        <PromptInputSubmit
          className="size-8 shrink-0 rounded-full"
          onStop={() => {
            void onCancelGeneration()
          }}
          status="streaming"
        />
      ) : null}
      <PromptInputSubmit
        className="ark-control-accent! size-8 shrink-0 rounded-full"
        disabled={!canSubmit || isInputDisabled}
        status="ready"
      />
    </div>
  )
}

export function ChatComposer() {
  const {
    contextSlot,
    prompt,
    cancelGeneration,
    canGenerate,
    setSelectedModel,
    reducedMotion,
    resolvedAppearance,
  } = useChatPanelRuntime()
  const { activeQuestions, activeThemes, interactionActive } = useChatInteractionLock()
  const input = useChatStore((state) => state.input)
  const setInput = useChatStore((state) => state.setInput)
  const setAttachmentError = useChatStore((state) => state.setAttachmentError)
  const isGenerating = useChatStore((state) => state.isGenerating)
  const models = useModelsStore((state) => state.models)
  const isLoadingModels = useModelsStore((state) => state.isLoading)
  const selectedModel = useShellStore((state) => state.selectedModel)
  const { getReasoningEffort, reasoningEffort, setReasoningEffort } = useReasoningEffort(
    selectedModel,
    models,
  )
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const selectedModelInfo = models.find((model) => model.id === selectedModel)
  const supportsAttachments = selectedModelInfo?.supportsAttachments ?? false
  const isSubmitDisabled = !canGenerate || interactionActive
  const isComposerLocked = interactionActive

  const handleModelSelect = (modelId: string, nextEffort?: ReasoningEffort) => {
    setSelectedModel(modelId)
    if (nextEffort) {
      setReasoningEffort(nextEffort, modelId)
    }
  }

  return (
    <ActiveComposer
      active={isGenerating || interactionActive}
      reducedMotion={reducedMotion}
      resolvedAppearance={resolvedAppearance}
    >
      <PromptInput
        accept="image/*,text/*,application/pdf"
        groupClassName={cn(
          'border-[var(--ark-line)] bg-[var(--ark-field)] shadow-none',
          'dark:bg-[var(--ark-field)]',
          'has-disabled:bg-[var(--ark-field)] has-disabled:opacity-100',
          'dark:has-disabled:bg-[var(--ark-field)]',
        )}
        maxFileSize={MAX_CHAT_ATTACHMENT_BYTES}
        multiple
        onError={(error) => setAttachmentError(formatAttachmentError(error))}
        onSubmit={prompt.handlePromptSubmit}
      >
        <PromptInputAttachmentsDisplay>{contextSlot}</PromptInputAttachmentsDisplay>
        <PromptInputBody>
          <PromptInputTextarea
            className="min-h-24 resize-none bg-transparent"
            disabled={isComposerLocked}
            onChange={(event) => setInput(event.currentTarget.value)}
            placeholder={
              activeThemes
                ? 'Pick a theme above to continue…'
                : activeQuestions
                  ? 'Answer the questions above to continue…'
                  : isGenerating
                    ? 'Queue a follow-up to send after this turn…'
                    : 'Describe the deck you want, or ask for an edit…'
            }
            value={input}
          />
        </PromptInputBody>
        <PromptInputFooter className="min-w-0 gap-2">
          <PromptInputTools className="min-w-0 flex-1 gap-2 overflow-hidden">
            <PromptInputActionMenu onOpenChange={setAttachMenuOpen} open={attachMenuOpen}>
              <PromptInputActionMenuTrigger
                aria-label="Add attachments"
                className={cn(morphMenuTriggerClassName, 'shrink-0')}
                disabled={!supportsAttachments || isComposerLocked}
              />
              {supportsAttachments ? (
                <MorphMenuContent className="w-48">
                  <div className="ark-scrollbar-none ark-morph-reveal min-h-0 flex-1 overflow-y-auto p-1">
                    <PromptInputActionAddAttachments />
                    <PromptInputActionAddScreenshot />
                  </div>
                  <MorphMenuFooter
                    className="px-2"
                    label="Collapse attachments menu"
                    onCollapse={() => setAttachMenuOpen(false)}
                  >
                    <PlusIcon aria-hidden className="size-4 shrink-0" />
                  </MorphMenuFooter>
                </MorphMenuContent>
              ) : null}
            </PromptInputActionMenu>
            <ModelSelector
              canGenerate={canGenerate}
              className="min-w-0"
              disabled={isGenerating}
              isLoading={isLoadingModels}
              models={models}
              getReasoningEffort={getReasoningEffort}
              onSelect={handleModelSelect}
              reasoningEffort={reasoningEffort}
              value={selectedModel}
            />
          </PromptInputTools>
          <ChatPromptInputSubmit
            input={input}
            isGenerating={isGenerating}
            isInputDisabled={isSubmitDisabled}
            onCancelGeneration={cancelGeneration}
          />
        </PromptInputFooter>
      </PromptInput>
    </ActiveComposer>
  )
}
