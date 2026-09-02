import { memo, useState, type ReactNode } from 'react'

import { DeckPreview } from '@/components/DeckPreview'
import { WorkspaceChatContextSlot } from '@/components/shell/WorkspaceChatContextSlot'
import { ChatPanel } from '@/components/ChatPanel'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useChatContextSlides } from '@/hooks/useChatContextSlides'
import { useDeckAnalysis } from '@/hooks/useDeckAnalysis'
import { useWorkspaceRuntimeContext } from '@/hooks/workspace-runtime-context'
import { CHAT_PANEL_MIN_WIDTH_PX } from '@/lib/chat/chat-panel-layout'
import { isChatPanelToggleTarget } from '@/lib/ui/app-shell-preferences'
import { useShellStore } from '@/state/shell-store.ts'

const MemoizedDeckPreview = memo(DeckPreview)

type EditorWorkspaceProps = {
  chatDefaultSize: number | string
  deckDefaultSizeWithChat: number | string
  onChatOpenChange: (open: boolean) => void
}

export function EditorWorkspace({
  chatDefaultSize,
  deckDefaultSizeWithChat,
  onChatOpenChange,
}: EditorWorkspaceProps) {
  const { initialSlideIndex, deckPreviewRef } = useWorkspaceRuntimeContext()
  const context = useChatContextSlides()
  useDeckAnalysis()
  const isDesktop = useShellStore((state) => state.isDesktop)
  const isChatOpen = useShellStore((state) => state.isChatOpen)
  const [deckChromeHost, setDeckChromeHost] = useState<HTMLDivElement | null>(null)
  const contextSlot = <WorkspaceChatContextSlot context={context} />

  const preview = (
    <MemoizedDeckPreview
      chromeHost={deckChromeHost}
      clearEditorSelectionRef={context.clearEditorSelectionRef}
      editorBridgeEnabled
      initialSlideIndex={initialSlideIndex}
      layout={isDesktop ? 'desktop' : 'mobile'}
      onToggleContextSlide={context.handleToggleContextSlide}
      presentHandleRef={deckPreviewRef}
    />
  )

  const chatPanel = <ChatPanel contextSlot={contextSlot} layout="sidebar" />

  return (
    <>
      <div className="shrink-0" ref={setDeckChromeHost} />
      {isDesktop ? (
        <ResizablePanelGroup className="min-h-0 flex-1 overflow-hidden" orientation="horizontal">
          <ResizablePanel
            defaultSize={isChatOpen ? deckDefaultSizeWithChat : '100%'}
            minSize={isChatOpen ? '55%' : '100%'}
          >
            {preview}
          </ResizablePanel>
          {isChatOpen ? (
            <>
              <ResizableHandle className="border-[var(--ark-line)]" />
              <ResizablePanel
                defaultSize={chatDefaultSize}
                id="ark-chat-panel"
                maxSize={460}
                minSize={CHAT_PANEL_MIN_WIDTH_PX}
              >
                {chatPanel}
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
      ) : (
        <EditorMobileLayout
          chatPanel={chatPanel}
          isChatOpen={isChatOpen}
          onChatOpenChange={onChatOpenChange}
          preview={preview}
        />
      )}
    </>
  )
}

function EditorMobileLayout({
  chatPanel,
  isChatOpen,
  onChatOpenChange,
  preview,
}: {
  chatPanel: ReactNode
  isChatOpen: boolean
  onChatOpenChange: (open: boolean) => void
  preview: ReactNode
}) {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-hidden">{preview}</div>
      <Sheet modal={false} onOpenChange={onChatOpenChange} open={isChatOpen}>
        <SheetContent
          aria-describedby="ark-agent-sheet-description"
          aria-labelledby="ark-agent-sheet-title"
          className="gap-0 p-0"
          forceMount
          id="ark-chat-panel"
          onFocusOutside={(event) => {
            if (isChatPanelToggleTarget(event.target)) {
              event.preventDefault()
            }
          }}
          onPointerDownOutside={(event) => {
            if (isChatPanelToggleTarget(event.target)) {
              event.preventDefault()
            }
          }}
        >
          <SheetTitle className="sr-only" id="ark-agent-sheet-title">
            Agent
          </SheetTitle>
          <SheetDescription className="sr-only" id="ark-agent-sheet-description">
            Build and edit the current deck with Ark.
          </SheetDescription>
          {chatPanel}
        </SheetContent>
      </Sheet>
    </>
  )
}
