import { memo, useState, type ReactNode } from 'react'

import { DeckPreview } from '@/components/DeckPreview'
import { WorkspaceChatContextSlot } from '@/components/shell/WorkspaceChatContextSlot'
import { WorkspaceChatPanel } from '@/components/shell/WorkspaceChatPanel'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useChatContextSlides } from '@/hooks/useChatContextSlides'
import { useDeckAnalysis } from '@/hooks/useDeckAnalysis'
import { useManualEditCommits } from '@/hooks/useManualEditCommits'
import { usePromptSubmit } from '@/hooks/usePromptSubmit'
import { useWorkspaceRuntimeContext } from '@/hooks/workspace-runtime-context'
import { CHAT_PANEL_MIN_WIDTH_PX } from '@/lib/chat/chat-panel-layout'
import { isChatPanelToggleTarget } from '@/lib/ui/app-shell-preferences'
import { routeDeckIdFromParam } from '@/lib/ui/workspace-mode'
import { useEditorStore } from '@/state/editor-store.ts'
import { useShellStore } from '@/state/shell-store.ts'
import { useParams } from 'react-router'

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
  const { persistence, generation, initialSlideIndex, deckPreviewRef } =
    useWorkspaceRuntimeContext()
  const { deckId: routeParam } = useParams<{ deckId: string }>()
  const routeDeckId = routeDeckIdFromParam(routeParam)
  const prompt = usePromptSubmit()
  const edits = useManualEditCommits()
  const context = useChatContextSlides()
  const deckAnalysis = useDeckAnalysis()
  const isDesktop = useShellStore((state) => state.isDesktop)
  const isChatOpen = useShellStore((state) => state.isChatOpen)
  const isStripOpen = useEditorStore((state) => state.isStripOpen)
  const [deckChromeHost, setDeckChromeHost] = useState<HTMLDivElement | null>(null)
  const contextSlot = <WorkspaceChatContextSlot context={context} />

  const preview = (
    <MemoizedDeckPreview
      state={{
        canRedo: edits.canRedo,
        canUndo: edits.canUndo,
        editorBridgeEnabled: true,
        isDeckLoading: Boolean(routeDeckId && persistence.isLoading),
        isGenerating: generation.isGenerating,
        isPreviewUpdating: generation.isPreviewUpdating ?? false,
        isStripOpen,
        isTextEditSaving: persistence.isPatching || persistence.isSaving,
      }}
      chromeHost={deckChromeHost}
      clearEditorSelectionRef={context.clearEditorSelectionRef}
      contextSlideIndexes={context.contextSlideIndexes}
      deckId={persistence.deckId}
      html={persistence.html}
      initialSlideIndex={initialSlideIndex}
      layout={isDesktop ? 'desktop' : 'mobile'}
      onCommitTextEdit={edits.handleCommitTextEdit}
      onEditorSelectionChange={context.handleEditorSelectionChange}
      onPatchEditorOperations={edits.handlePatchEditorOperations}
      onReorderSlide={edits.handleReorderSlide}
      presentHandleRef={deckPreviewRef}
      onRedo={edits.handleRedoEdit}
      onRestoreDocumentHistory={edits.handleRestoreDocumentHistory}
      onToggleContextSlide={context.handleToggleContextSlide}
      onUndo={edits.handleUndoEdit}
      deckAnalysis={deckAnalysis}
      redoSlideIndex={edits.redoSlideIndex}
      recentGenerationJobId={generation.recentGenerationJobId}
      undoSlideIndex={edits.undoSlideIndex}
      documentRevision={persistence.documentRevision}
    />
  )

  const chatPanel = (
    <WorkspaceChatPanel contextSlot={contextSlot} layout="sidebar" prompt={prompt} />
  )

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
