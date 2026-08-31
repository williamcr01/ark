import { CHAT_PANEL_MIN_WIDTH_PX } from '@/lib/chat/chat-panel-layout'

import { AgentInteractionModal } from '@/components/AgentInteractionModal'
import { AppTitleBar } from '@/components/AppTitleBar'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

import { isChatPanelToggleTarget } from '@/lib/ui/app-shell-preferences'

import { useAppShell } from '@/hooks/useAppShell'

export default function App() {
  const {
    activeMcpInteraction,
    canGenerateForDeck,
    cancelMcpInteraction,
    chatDefaultSize,
    chatPanel,
    deckDefaultSizeWithChat,
    deckPreview,
    deckId,
    deckPreviewRef,
    deckTitle,
    fileInputRef,
    pptxFileInputRef,
    filePath,
    generateDeck,
    handleChatOpenChange,
    handleDownload,
    handleDuplicate,
    handleExport,
    exportingDeck,
    handleHtmlUpload,
    handlePptxUpload,
    handleMove,
    handleNewDeck,
    handleOpenWorkspace,
    handleRenameDeck,
    handleSaveAs,
    handleShareProject,
    handleToggleChat,
    handleUploadClick,
    handlePptxImportClick,
    hasDeck,
    hasSlides,
    isChatOpen,
    isDesktop,
    isGenerating,
    isStripOpen,
    loadModels,
    mainRef,
    normalAgentQuestions,
    normalThemeProposal,
    preference,
    respondToMcpInteraction,
    setAgentInteractionsInModal,
    setDeckChromeHost,
    setIsStripOpen,
    setPreference,
    showSanitizedDownload,
  } = useAppShell()

  return (
    <TooltipProvider>
      <div className="flex h-svh min-h-0 flex-col bg-[var(--ark-canvas)] text-foreground">
        <AppTitleBar
          activeDeckId={deckId}
          deckTitle={deckTitle}
          fileInputRef={fileInputRef}
          pptxFileInputRef={pptxFileInputRef}
          uiState={{
            hasDeck,
            hasSlides,
            isChatOpen,
            isGenerating,
            isStripOpen,
            showSanitizedDownload,
          }}
          appearancePreference={preference}
          onDownload={handleDownload}
          onExport={handleExport}
          exportingDeck={exportingDeck}
          onAgentInteractionsInModalChange={setAgentInteractionsInModal}
          onHtmlUpload={handleHtmlUpload}
          onPptxUpload={handlePptxUpload}
          onCredentialsChanged={loadModels}
          onNewDeck={handleNewDeck}
          onOpenWorkspace={handleOpenWorkspace}
          onSaveAs={handleSaveAs}
          onMove={handleMove}
          onReveal={() => filePath && void window.arkDesktop.files.reveal(filePath)}
          onDuplicate={handleDuplicate}
          onShareProject={handleShareProject}
          onPresent={() => deckPreviewRef.current?.openPresent()}
          onRenameDeck={handleRenameDeck}
          onToggleChat={handleToggleChat}
          onToggleStrip={() => setIsStripOpen((current) => !current)}
          onAppearanceChange={setPreference}
          onUploadClick={handleUploadClick}
          onPptxImportClick={handlePptxImportClick}
        />

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden" ref={mainRef}>
          <div className="shrink-0" ref={setDeckChromeHost} />
          {isDesktop ? (
            <ResizablePanelGroup
              className="min-h-0 flex-1 overflow-hidden"
              orientation="horizontal"
            >
              <ResizablePanel
                defaultSize={isChatOpen ? deckDefaultSizeWithChat : '100%'}
                minSize={isChatOpen ? '55%' : '100%'}
              >
                {deckPreview}
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
            <>
              <div className="min-h-0 flex-1 overflow-hidden">{deckPreview}</div>
              {/*
                Non-modal drawer: Radix renders no backdrop for modal={false}, so the
                deck stays visible and interactive while the agent panel is open.
              */}
              <Sheet modal={false} onOpenChange={handleChatOpenChange} open={isChatOpen}>
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
          )}
        </main>
      </div>
      <AgentInteractionModal
        agentQuestions={normalAgentQuestions}
        disabled={isGenerating || !canGenerateForDeck}
        mcpInteraction={activeMcpInteraction}
        onAgentQuestionSubmit={(content) => {
          void generateDeck(content)
        }}
        onMcpInteractionCancel={() => {
          void cancelMcpInteraction()
        }}
        onMcpInteractionSubmit={(answer) => {
          void respondToMcpInteraction(answer)
        }}
        themeProposal={normalThemeProposal}
      />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}
