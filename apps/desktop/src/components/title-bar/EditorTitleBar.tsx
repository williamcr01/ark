import { ButtonGroup } from '@/components/ui/button-group'
import { useDeckAnalysis } from '@/hooks/useDeckAnalysis'
import { useDeckExport } from '@/hooks/useDeckExport'
import { useWorkspaceFileActions } from '@/hooks/useWorkspaceFileActions'
import { useWorkspaceRuntimeContext } from '@/hooks/workspace-runtime-context'
import { lintDeckHtmlForExport } from '@/lib/deck/export-lint'
import { useChatStore } from '@/state/chat-store.ts'
import { selectHasDeck, useDeckStore } from '@/state/deck-store.ts'
import { useEditorStore } from '@/state/editor-store.ts'
import { useShellStore } from '@/state/shell-store.ts'

import { TitleBarBrand } from './TitleBarBrand'
import { TitleBarDeckActions } from './TitleBarDeckActions'
import { TitleBarDeckTitle } from './TitleBarDeckTitle'
import { TitleBarFileInputs } from './TitleBarFileInputs'
import { TitleBarFileMenu, TitleBarImportButtons } from './TitleBarFileMenu'
import { TitleBarNavTabs } from './TitleBarNavTabs'
import { TitleBarSettingsButton } from './TitleBarSettingsButton'
import { TitleBarChatToggle, TitleBarStripToggle } from './TitleBarViewToggles'
import type { AppTitleBarNav } from './title-bar-types'

export function EditorTitleBar({
  navActive,
  onToggleChat,
}: {
  navActive: AppTitleBarNav
  onToggleChat?: () => void
}) {
  const model = useEditorTitleBarModel(onToggleChat)

  return (
    <>
      <TitleBarFileInputs
        fileInputRef={model.files.refs.fileInputRef}
        onHtmlUpload={model.files.importDeck.handleHtmlUpload}
        onPptxUpload={model.files.importDeck.handlePptxUpload}
        pptxFileInputRef={model.files.refs.pptxFileInputRef}
      />
      {model.hasSlides ? (
        <ButtonGroup className="shrink-0">
          <TitleBarStripToggle
            hasSlides={model.hasSlides}
            isStripOpen={model.isStripOpen}
            onToggleStrip={model.handleToggleStrip}
          />
        </ButtonGroup>
      ) : null}
      <div className="flex min-w-0 items-center gap-3 px-1">
        <TitleBarBrand />
        <TitleBarNavTabs
          disabled={model.isGenerating}
          navActive={navActive}
          onNew={model.files.handleNewDeck}
        />
        <span aria-hidden className="text-muted-foreground">
          /
        </span>
        <TitleBarDeckTitle
          activeDeckId={model.deckId}
          deckTitle={model.deckTitle}
          disabled={model.isGenerating}
          onRenameDeck={model.files.handleRenameDeck}
        />
      </div>
      <div aria-hidden className="min-w-0 flex-1" />
      <ButtonGroup className="shrink-0">
        <TitleBarSettingsButton onCredentialsChanged={model.loadModels} showMcp />
        <TitleBarFileMenu
          activeDeckId={model.deckId}
          isGenerating={model.isGenerating}
          onDuplicate={model.files.handleDuplicate}
          onMove={model.files.handleMove}
          onOpenWorkspace={model.files.handleOpenWorkspace}
          onPptxImportClick={model.files.importDeck.handlePptxImportClick}
          onReveal={model.handleReveal}
          onSaveAs={model.files.handleSaveAs}
          onShareProject={model.files.handleShareProject}
          onUploadClick={model.files.importDeck.handleUploadClick}
          variant="editor"
        />
        <TitleBarDeckActions
          disabled={!model.hasDeck}
          exportLint={model.exportLint}
          exporting={model.exportingDeck}
          hasSlides={model.hasSlides}
          isGenerating={model.isGenerating}
          onDownload={model.files.handleDownload}
          onExport={model.handleExport}
          onPresent={model.handlePresent}
          showSanitizedDownload={model.showSanitizedDownload}
        >
          <TitleBarImportButtons
            isGenerating={model.isGenerating}
            onPptxImportClick={model.files.importDeck.handlePptxImportClick}
            onUploadClick={model.files.importDeck.handleUploadClick}
          />
        </TitleBarDeckActions>
        <TitleBarChatToggle isChatOpen={model.isChatOpen} onToggleChat={model.handleToggleChat} />
      </ButtonGroup>
    </>
  )
}

function useEditorTitleBarModel(onToggleChat?: () => void) {
  const { models, deckPreviewRef } = useWorkspaceRuntimeContext()
  const files = useWorkspaceFileActions()
  const { handleExport, exportingDeck } = useDeckExport()
  const analysis = useDeckAnalysis()
  const deckId = useDeckStore((state) => state.deckId)
  const deckTitle = useDeckStore((state) => state.deckTitle)
  const filePath = useDeckStore((state) => state.filePath)
  const html = useDeckStore((state) => state.html)
  const hasDeck = useDeckStore(selectHasDeck)
  const isGenerating = useChatStore((state) => state.isGenerating)
  const isChatOpen = useShellStore((state) => state.isChatOpen)
  const isStripOpen = useEditorStore((state) => state.isStripOpen)
  const setStripOpen = useEditorStore((state) => state.setStripOpen)

  return {
    deckId,
    deckTitle,
    exportingDeck,
    exportLint: lintDeckHtmlForExport(html).entries,
    files,
    handleExport,
    handlePresent: () => deckPreviewRef.current?.openPresent(),
    handleReveal: () => {
      if (filePath) void window.arkDesktop.files.reveal(filePath)
    },
    handleToggleChat: onToggleChat ?? toggleChatFromStore,
    handleToggleStrip: () => setStripOpen((current) => !current),
    hasDeck,
    hasSlides: analysis.slideCount > 0,
    isChatOpen,
    isGenerating,
    isStripOpen,
    loadModels: models.loadModels,
    showSanitizedDownload: analysis.hasExecutableContent,
  }
}

function toggleChatFromStore() {
  const next = !useShellStore.getState().isChatOpen
  useShellStore.getState().setChatOpen(next)
}
