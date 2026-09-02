import { AppTitleBar } from '@/components/AppTitleBar'
import { useDeckAnalysis } from '@/hooks/useDeckAnalysis'
import { useDeckExport } from '@/hooks/useDeckExport'
import { useWorkspaceFileActions } from '@/hooks/useWorkspaceFileActions'
import { useWorkspaceRuntimeContext } from '@/hooks/workspace-runtime-context'
import { lintDeckHtmlForExport } from '@/lib/deck/export-lint'
import { useEditorStore } from '@/state/editor-store.ts'
import { useShellStore } from '@/state/shell-store.ts'

type WorkspaceTitleBarProps = {
  onToggleChat: () => void
}

export function WorkspaceTitleBar({ onToggleChat }: WorkspaceTitleBarProps) {
  const { persistence, generation, models, workspaceMode, deckPreviewRef } =
    useWorkspaceRuntimeContext()
  const files = useWorkspaceFileActions()
  const { handleExport, exportingDeck } = useDeckExport()
  const analysis = useDeckAnalysis()
  const preference = useShellStore((state) => state.appearancePreference)
  const setPreference = useShellStore((state) => state.setAppearancePreference)
  const setAgentInteractionsInModal = useShellStore((state) => state.setAgentInteractionsInModal)
  const isChatOpen = useShellStore((state) => state.isChatOpen)
  const isStripOpen = useEditorStore((state) => state.isStripOpen)
  const setIsStripOpen = useEditorStore((state) => state.setStripOpen)
  const isCreationWorkspace = workspaceMode === 'create'

  return (
    <AppTitleBar
      activeDeckId={persistence.deckId}
      deckTitle={persistence.deckTitle}
      fileInputRef={files.refs.fileInputRef}
      navActive={isCreationWorkspace ? 'new' : null}
      pptxFileInputRef={files.refs.pptxFileInputRef}
      uiState={{
        hasDeck: persistence.hasDeck,
        hasSlides: analysis.slideCount > 0,
        isChatOpen,
        isGenerating: generation.isGenerating,
        isStripOpen,
        showSanitizedDownload: analysis.hasExecutableContent,
      }}
      variant={isCreationWorkspace ? 'home' : 'editor'}
      appearancePreference={preference}
      onDownload={files.handleDownload}
      onExport={handleExport}
      exportingDeck={exportingDeck}
      exportLint={lintDeckHtmlForExport(persistence.html).entries}
      onAgentInteractionsInModalChange={setAgentInteractionsInModal}
      onHtmlUpload={files.importDeck.handleHtmlUpload}
      onPptxUpload={files.importDeck.handlePptxUpload}
      catalogWarnings={models.warnings}
      onCredentialsChanged={models.loadModels}
      onNewDeck={files.handleNewDeck}
      onOpenWorkspace={files.handleOpenWorkspace}
      onSaveAs={files.handleSaveAs}
      onMove={files.handleMove}
      onReveal={() =>
        persistence.filePath && void window.arkDesktop.files.reveal(persistence.filePath)
      }
      onDuplicate={files.handleDuplicate}
      onShareProject={files.handleShareProject}
      onPresent={() => deckPreviewRef.current?.openPresent()}
      onRenameDeck={files.handleRenameDeck}
      onToggleChat={onToggleChat}
      onToggleStrip={() => setIsStripOpen((current) => !current)}
      onAppearanceChange={setPreference}
      onUploadClick={files.importDeck.handleUploadClick}
      onPptxImportClick={files.importDeck.handlePptxImportClick}
    />
  )
}
