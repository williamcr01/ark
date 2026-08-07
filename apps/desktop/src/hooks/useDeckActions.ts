import {
  useCallback,
  type ChangeEvent,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'

import { toast } from 'sonner'

import type { ChatMessage } from '@ark/deck-core/chat.ts'
import {
  describeDeckValidation,
  downloadHtml,
  isHtmlDeckFile,
  validateUploadedDeck,
} from '@/lib/deck-io'
import type { DeckDownloadVariant } from '@/lib/deck-export'
import { newId } from '@/lib/id'
import { exportDeckHtml } from '@/lib/deck-api'

import type { useChatSession } from './useChatSession'
import type { useDeckPersistence } from './useDeckPersistence'
import { clearStoredGenerationJob } from './useGenerationJob'

type DeckPersistenceApi = ReturnType<typeof useDeckPersistence>
type ChatSessionApi = ReturnType<typeof useChatSession>

type DeckActionsDeckSlice = Pick<
  DeckPersistenceApi,
  | 'deckId'
  | 'html'
  | 'persistHtml'
  | 'startNewDeck'
  | 'renameActiveDeck'
  | 'deleteActiveDeck'
  | 'deckTitle'
>

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
    async (event: ChangeEvent<HTMLInputElement>) => {
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

        let savedDeckId = deckId

        try {
          const savedDeck = await persistHtml(html)

          if (savedDeck?.id) {
            savedDeckId = savedDeck.id
          }
        } catch {
          toast.error('Deck loaded but could not be saved')
        }

        onEditHistoryBoundary?.()

        setError('')
        const uploadMessage: ChatMessage = {
          id: newId(),
          role: 'assistant',
          content: `Loaded ${file.name} into the preview. Validation: ${describeDeckValidation(validation)}. You can ask Ark to revise this HTML deck now.`,
        }

        if (savedDeckId) {
          await appendMessage(uploadMessage, savedDeckId)
        } else {
          setMessages((current) => [...current, uploadMessage])
        }
        toast.success('HTML deck loaded')
      } catch {
        toast.error('Could not read that HTML file')
      }
    },
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
