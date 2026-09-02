import { ChatSendQueue } from '@/components/ChatSendQueue'
import { useChatPanelRuntime } from '@/components/chat/chat-panel-runtime'

export function ChatQueuedSends() {
  const { prompt } = useChatPanelRuntime()
  const { queuedSends, dismissQueuedSend, updateQueuedText, sendQueuedAll, sendQueuedNow } = prompt

  if (queuedSends.length === 0) {
    return null
  }

  return (
    <ChatSendQueue
      items={queuedSends}
      onDismiss={dismissQueuedSend}
      onEdit={updateQueuedText}
      onSendAll={sendQueuedAll}
      onSendNow={sendQueuedNow}
    />
  )
}
