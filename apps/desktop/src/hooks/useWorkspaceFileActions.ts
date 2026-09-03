import { useCallback, useRef, type ChangeEvent, type RefObject } from 'react'
import { useNavigate } from 'react-router'

import { toWorkspaceFileName } from '@/lib/deck/workspace-file-name'
import {
  importPptxFromFile,
  importPptxFromPath,
  isPowerPointPath,
} from '@/lib/workspace/pptx-import'
import { runWorkspacePickFlow } from '@/lib/workspace/workspace-pick-flow'
import { useChatStore } from '@/state/chat-store.ts'
import { useEditorStore } from '@/state/editor-store.ts'

import { useDeckActions } from './useDeckActions'
import { useWorkspaceRuntimeContext } from './workspace-runtime-context'

function useBoundDeckActions(fileInputRef: RefObject<HTMLInputElement | null>) {
  const { persistence, chat } = useWorkspaceRuntimeContext()
  const setInput = useChatStore((state) => state.setInput)

  return useDeckActions({
    fileInputRef,
    deck: {
      deckId: persistence.deckId,
      html: persistence.html,
      persistHtml: persistence.persistHtml,
      startNewDeck: persistence.startNewDeck,
      renameActiveDeck: persistence.renameActiveDeck,
      deleteActiveDeck: persistence.deleteActiveDeck,
      deckTitle: persistence.deckTitle,
    },
    chat: {
      appendMessage: chat.appendMessage,
      setMessages: chat.setMessages,
      resetChat: chat.resetChat,
    },
    setInput,
    setError: (update) => {
      const current = useChatStore.getState().workspaceError
      useChatStore
        .getState()
        .setWorkspaceError(typeof update === 'function' ? update(current) : update)
    },
    onEditHistoryBoundary: () => useEditorStore.getState().resetHistory(),
  })
}

export function useWorkspaceFileActions() {
  const navigate = useNavigate()
  const { persistence, workspaceMode } = useWorkspaceRuntimeContext()
  const isCreationWorkspace = workspaceMode === 'create'
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pptxFileInputRef = useRef<HTMLInputElement>(null)
  const deckActions = useBoundDeckActions(fileInputRef)

  const handleNewDeck = useCallback(async () => {
    if (isCreationWorkspace) {
      return
    }
    useChatStore.getState().clearSends()
    await deckActions.handleNewDeck()
    navigate('/')
  }, [deckActions, isCreationWorkspace, navigate])

  const handleOpenWorkspace = useCallback(async () => {
    const path = await window.arkDesktop.files.openWorkspace()
    if (!path) return
    if (isPowerPointPath(path)) {
      const deck = await importPptxFromPath(path)
      if (deck) navigate(`/decks/${deck.id}`)
      return
    }
    const deck = await persistence.openWorkspaceFile(path)
    navigate(`/decks/${deck.id}`)
  }, [navigate, persistence])

  const handlePptxImportClick = useCallback(() => {
    pptxFileInputRef.current?.click()
  }, [])

  const handlePptxUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''
      if (!file) return
      const deck = await importPptxFromFile(file)
      if (deck) navigate(`/decks/${deck.id}`)
    },
    [navigate],
  )

  const workspaceFileName = toWorkspaceFileName(persistence.deckTitle)
  const handleSaveAs = useCallback(
    () =>
      runWorkspacePickFlow(
        workspaceFileName,
        (path, overwrite) => persistence.saveAs(path, overwrite),
        'Workspace saved',
      ),
    [persistence, workspaceFileName],
  )
  const handleMove = useCallback(
    () =>
      runWorkspacePickFlow(
        workspaceFileName,
        (path, overwrite) => persistence.moveTo(path, overwrite),
        'Workspace moved',
      ),
    [persistence, workspaceFileName],
  )
  const handleDuplicate = useCallback(async () => {
    const deck = await persistence.duplicate('presentation')
    navigate(`/decks/${deck.id}`)
  }, [navigate, persistence])
  const handleShareProject = useCallback(async () => {
    if (
      !window.confirm(
        'Share Ark Project may contain prompts, conversations, and source files. Continue?',
      )
    ) {
      return
    }
    await runWorkspacePickFlow(
      workspaceFileName,
      (path, overwrite) => persistence.duplicate('complete', path, overwrite),
      'Ark project shared',
    )
  }, [persistence, workspaceFileName])

  return {
    refs: { fileInputRef, pptxFileInputRef },
    handleNewDeck,
    handleOpenWorkspace,
    handleSaveAs,
    handleMove,
    handleDuplicate,
    handleShareProject,
    importDeck: {
      handlePptxUpload,
      handlePptxImportClick,
      handleHtmlUpload: deckActions.handleHtmlUpload,
      handleUploadClick: deckActions.handleUploadClick,
    },
    handleDownload: deckActions.handleDownload,
    handleRenameDeck: deckActions.handleRenameDeck,
  }
}
