import {
  PanelLeftCloseIcon,
  PanelLeftIcon,
  PanelRightCloseIcon,
  PanelRightIcon,
} from 'lucide-react'

import { TitleBarButton } from './TitleBarButton'

export function TitleBarViewToggles({
  hasSlides,
  isChatOpen,
  isStripOpen,
  onToggleChat,
  onToggleStrip,
  showChat,
  showStrip,
}: {
  hasSlides: boolean
  isChatOpen: boolean
  isStripOpen: boolean
  onToggleChat: () => void
  onToggleStrip: () => void
  showChat?: boolean
  showStrip?: boolean
}) {
  return (
    <>
      {showStrip && hasSlides ? (
        <TitleBarButton
          aria-controls="ark-slide-strip"
          aria-expanded={isStripOpen}
          label={isStripOpen ? 'Hide slide thumbnails' : 'Show slide thumbnails'}
          onClick={onToggleStrip}
        >
          {isStripOpen ? <PanelLeftCloseIcon /> : <PanelLeftIcon />}
        </TitleBarButton>
      ) : null}
      {showChat ? (
        <TitleBarButton
          aria-controls="ark-chat-panel"
          aria-expanded={isChatOpen}
          label={isChatOpen ? 'Hide chat panel (Ctrl/⌘B)' : 'Show chat panel (Ctrl/⌘B)'}
          onClick={onToggleChat}
        >
          {isChatOpen ? <PanelRightCloseIcon /> : <PanelRightIcon />}
        </TitleBarButton>
      ) : null}
    </>
  )
}
