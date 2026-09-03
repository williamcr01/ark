import {
  useCallback,
  type ChangeEvent,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'

import { toast } from 'sonner'

import type { ChatMessage } from '@ark/chat/messages.ts'
import {
  describeDeckValidation,
  downloadHtml,
  isHtmlDeckFile,
  validateUploadedDeck,
} from '@/lib/deck/deck-io'
import type { DeckDownloadVariant } from '@/lib/deck/deck-export'
import { newId } from '@/lib/ui/id'
import { exportDeckHtml } from '@/lib/api/deck-api'

import type { DeckDocumentActions, DeckPersistenceActions } from './deck-persistence.ts'
import type { useChatSession } from './useChatSession'
import { clearStoredGenerationJob } from './useGenerationJob'

type ChatSessionApi = ReturnType<typeof useChatSession>

export type DeckActionsDeckSlice = {
  deckId: string | null
  html: string
  persistHtml: DeckPersistenceActions['persistHtml']
  startNewDeck: DeckPersistenceActions['startNewDeck']
  renameActiveDeck: DeckDocumentActions['renameActiveDeck']
  deleteActiveDeck: DeckDocumentActions['deleteActiveDeck']
  deckTitle: string
}

type DeckActionsChatSlice = Pick<ChatSessionApi, 'appendMessage' | 'setMessages' | 'resetChat'>

export type UseDeckActionsOptions = {
  fileInputRef: RefObject<HTMLInputElement | null>
  deck: DeckActionsDeckSlice
  chat: DeckActionsChatSlice
  setInput: Dispatch<SetStateAction<string>>
  setError: Dispatch<SetStateAction<string>>
  /** Called when undo/redo history should reset after upload. */
  onEditHistoryBoundary?: () => void
}

/**
 * Deck lifecycle handlers used by the shell chrome: upload/download, deck CRUD
 * (new/rename/delete). Extracted from `App.tsx`;
 * behavior is intended to be identical to the previous inline implementation.
 */
export function useDeckActions({
  fileInputRef,
  deck,
  chat,
  setInput,
  setError,
  onEditHistoryBoundary,
}: UseDeckActionsOptions) {
  const {
    deckId,
    html: generatedHtml,
    persistHtml,
    startNewDeck,
    renameActiveDeck,
    deleteActiveDeck,
    deckTitle,
  } = deck
  const { appendMessage, setMessages, resetChat } = chat

  const handleDownload = useCallback(
    async (variant: DeckDownloadVariant = 'original') => {
      if (!generatedHtml || !deckId) {
        return
      }

      const exportedHtml = await exportDeckHtml(deckId, variant === 'sanitized')
      downloadHtml(exportedHtml, { baseName: deckTitle })
      toast.success(
        variant === 'sanitized' ? 'Sanitized HTML deck downloaded' : 'HTML deck downloaded',
      )
    },
    [deckId, deckTitle, generatedHtml],
  )

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [fileInputRef])

  const handleHtmlUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      importHtmlDeckFile(event, {
        appendMessage,
        deckId,
        onEditHistoryBoundary,
        persistHtml,
        setError,
        setMessages,
      }),
    [appendMessage, deckId, onEditHistoryBoundary, persistHtml, setError, setMessages],
  )

  const handleNewDeck = useCallback(async () => {
    await startNewDeck()
    clearStoredGenerationJob(null)
    void resetChat(null)
    setInput('')
    setError('')
    toast.info('Started a fresh deck')
  }, [resetChat, setError, setInput, startNewDeck])

  const handleRenameDeck = useCallback(
    async (title: string) => {
      try {
        await renameActiveDeck(title)
        toast.success('Deck renamed')
      } catch (renameError) {
        toast.error('Could not rename deck')
        throw renameError
      }
    },
    [renameActiveDeck],
  )

  const handleDeleteDeck = useCallback(async () => {
    try {
      await deleteActiveDeck()
      // Explicit null: ref may still hold the deleted deck id after clearActiveDeck.
      await resetChat(null)
      setInput('')
      setError('')
      toast.success('Deck deleted')
    } catch {
      toast.error('Could not delete deck')
    }
  }, [deleteActiveDeck, resetChat, setError, setInput])

  return {
    handleDeleteDeck,
    handleDownload,
    handleHtmlUpload,
    handleNewDeck,
    handleRenameDeck,
    handleUploadClick,
  }
}

async function importHtmlDeckFile(
  event: ChangeEvent<HTMLInputElement>,
  options: {
    appendMessage: ChatSessionApi['appendMessage']
    deckId: string | null
    onEditHistoryBoundary?: () => void
    persistHtml: DeckPersistenceActions['persistHtml']
    setError: Dispatch<SetStateAction<string>>
    setMessages: ChatSessionApi['setMessages']
  },
) {
  const file = event.currentTarget.files?.[0]
  event.currentTarget.value = ''

  if (!file) {
    return
  }

  if (!isHtmlDeckFile(file)) {
    toast.error('Upload an .html file')
    return
  }

  try {
    const html = await file.text()
    const validation = validateUploadedDeck(html)

    if (!validation.valid) {
      const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')
      toast.error(primaryIssue?.message ?? 'That file does not look like a valid Ark HTML deck')
      return
    }

    let savedDeckId = options.deckId

    try {
      const savedDeck = await options.persistHtml(html)

      if (savedDeck?.id) {
        savedDeckId = savedDeck.id
      }
    } catch {
      toast.error('Deck loaded but could not be saved')
    }

    options.onEditHistoryBoundary?.()

    options.setError('')
    const uploadMessage: ChatMessage = {
      id: newId(),
      role: 'assistant',
      content: `Loaded ${file.name} into the preview. Validation: ${describeDeckValidation(validation)}. You can ask Ark to revise this HTML deck now.`,
    }

    if (savedDeckId) {
      await options.appendMessage(uploadMessage, savedDeckId)
    } else {
      options.setMessages((current) => [...current, uploadMessage])
    }
    toast.success('HTML deck loaded')
  } catch {
    toast.error('Could not read that HTML file')
  }
}
