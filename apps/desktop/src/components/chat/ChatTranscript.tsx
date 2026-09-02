import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import {
  ChatHistoryContext,
  ChatMessageAttachments,
  ChatMessageDeliveryStatus,
  ChatMessageParts,
} from '@/components/chat/ChatMessageParts'
import { useChatPanelRuntime } from '@/components/chat/chat-panel-runtime'
import { shouldShowLiveAssistant } from '@/lib/chat/chat-message-parts'
import { findAskUserAnswerAfter, isAskUserAnswerMessage } from '@/lib/chat/agent-questions'
import { findThemeChoiceAfter, isThemeChoiceMessage } from '@/lib/chat/agent-themes'
import {
  selectActiveJobId,
  selectActiveSteps,
  selectGenerationStatus,
  useChatStore,
} from '@/state/chat-store.ts'
import { agentStepsToChatParts } from '@ark/chat/api-projection.ts'

export function ChatTranscript() {
  const { layout, retryPersist } = useChatPanelRuntime()
  const messages = useChatStore((state) => state.messages)
  const isGenerating = useChatStore((state) => state.isGenerating)
  const activeSteps = useChatStore(selectActiveSteps)
  const activeJobId = useChatStore(selectActiveJobId)
  const generationStatus = useChatStore(selectGenerationStatus)
  const trackedDeckId = useChatStore((state) => state.trackedDeckId)
  const deliveryStatus = useChatStore((state) => state.deliveryStatus)
  const showLiveAssistant = shouldShowLiveAssistant(
    messages,
    isGenerating,
    activeJobId,
    generationStatus,
    activeSteps.length,
  )
  const isHome = layout === 'home'

  return (
    <Conversation>
      <ConversationContent className={isHome ? 'gap-6 px-1 py-10 sm:px-2' : 'gap-5 px-5 py-6'}>
        {messages.length > 0
          ? messages.map((message, index) => {
              if (isAskUserAnswerMessage(messages, index)) return null
              if (isThemeChoiceMessage(messages, index)) return null

              const askUserAnswers =
                message.role === 'assistant'
                  ? (findAskUserAnswerAfter(messages, index)?.content ?? null)
                  : null
              const themeChoice =
                message.role === 'assistant'
                  ? (findThemeChoiceAfter(messages, index)?.content ?? null)
                  : null
              const status = trackedDeckId ? (deliveryStatus.get(message.id) ?? 'saved') : undefined

              return (
                <Message from={message.role} key={message.id}>
                  <MessageContent>
                    {message.parts?.length ? (
                      <ChatMessageParts
                        askUserAnswers={askUserAnswers}
                        parts={message.parts}
                        themeChoice={themeChoice}
                      />
                    ) : (
                      <MessageResponse>{message.content}</MessageResponse>
                    )}
                    {message.attachments?.length ? (
                      <ChatMessageAttachments attachments={message.attachments} />
                    ) : null}
                    {message.role === 'user' && message.context ? (
                      <ChatHistoryContext context={message.context} />
                    ) : null}
                    <ChatMessageDeliveryStatus
                      onRetry={
                        retryPersist
                          ? () => {
                              void retryPersist(message.id)
                            }
                          : undefined
                      }
                      status={status}
                    />
                  </MessageContent>
                </Message>
              )
            })
          : null}
        {showLiveAssistant ? (
          <Message from="assistant">
            <MessageContent>
              <div className="flex flex-col gap-2">
                <span className="sr-only">Working…</span>
                {activeSteps.length > 0 ? (
                  <ChatMessageParts live parts={agentStepsToChatParts(activeSteps)} />
                ) : null}
              </div>
            </MessageContent>
          </Message>
        ) : null}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}
