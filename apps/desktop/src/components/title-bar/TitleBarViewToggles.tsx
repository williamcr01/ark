import {
  PanelLeftCloseIcon,
  PanelLeftIcon,
  PanelRightCloseIcon,
  PanelRightIcon,
} from 'lucide-react'

import { TitleBarButton } from './TitleBarButton'

export function TitleBarStripToggle({
  hasSlides,
  isStripOpen,
  onToggleStrip,
}: {
  hasSlides: boolean
  isStripOpen: boolean
  onToggleStrip: () => void
}) {
  if (!hasSlides) {
    return null
  }

  return (
    <TitleBarButton
      aria-controls="ark-slide-strip"
      aria-expanded={isStripOpen}
      label={isStripOpen ? 'Hide slide thumbnails' : 'Show slide thumbnails'}
      onClick={onToggleStrip}
    >
      {isStripOpen ? <PanelLeftCloseIcon /> : <PanelLeftIcon />}
    </TitleBarButton>
  )
}

export function TitleBarChatToggle({
  isChatOpen,
  onToggleChat,
}: {
  isChatOpen: boolean
  onToggleChat: () => void
}) {
  return (
    <TitleBarButton
      aria-controls="ark-chat-panel"
      aria-expanded={isChatOpen}
      label={isChatOpen ? 'Hide chat panel (Ctrl/⌘B)' : 'Show chat panel (Ctrl/⌘B)'}
      onClick={onToggleChat}
    >
      {isChatOpen ? <PanelRightCloseIcon /> : <PanelRightIcon />}
    </TitleBarButton>
  )
}
