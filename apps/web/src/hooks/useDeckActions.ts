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

import type { useChatSession } from './useChatSession'
import type { useDeckPersistence } from './useDeckPersistence'

type DeckPersistenceApi = ReturnType<typeof useDeckPersistence>
type ChatSessionApi = ReturnType<typeof useChatSession>

type DeckActionsDeckSlice = Pick<
  DeckPersistenceApi,
  | 'deckId'
  | 'html'
  | 'persistHtml'
  | 'rollbackToVersion'
  | 'selectDeck'
  | 'startNewDeck'
  | 'renameActiveDeck'
  | 'deleteActiveDeck'
>

type DeckActionsChatSlice = Pick<ChatSessionApi, 'appendMessage' | 'setMessages' | 'resetChat'>

export type UseDeckActionsOptions = {
  fileInputRef: RefObject<HTMLInputElement | null>
  deck: DeckActionsDeckSlice
  chat: DeckActionsChatSlice
  setInput: Dispatch<SetStateAction<string>>
  setError: Dispatch<SetStateAction<string>>
  /** Called when undo/redo history should reset (rollback, upload). */
  onEditHistoryBoundary?: () => void
}

/**
 * Deck lifecycle handlers used by the shell chrome: upload/download, deck CRUD
 * (new/select/rename/delete), and version rollback. Extracted from `App.tsx`;
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
    rollbackToVersion,
    selectDeck,
    startNewDeck,
    renameActiveDeck,
    deleteActiveDeck,
  } = deck
  const { appendMessage, setMessages, resetChat } = chat

  const handleRollbackVersion = useCallback(
    async (versionId: string) => {
      try {
        await rollbackToVersion(versionId)
        onEditHistoryBoundary?.()
        await resetChat()
        setInput('')
        setError('')
        toast.success('Deck restored to selected version')
      } catch {
        toast.error('Could not restore that version')
        throw new Error('Could not restore that version')
      }
    },
    [onEditHistoryBoundary, resetChat, rollbackToVersion, setError, setInput],
  )

  const handleDownload = useCallback(
    (variant: DeckDownloadVariant = 'original') => {
      if (!generatedHtml) {
        return
      }

      downloadHtml(generatedHtml, { variant })
      toast.success(
        variant === 'sanitized' ? 'Sanitized HTML deck downloaded' : 'HTML deck downloaded',
      )
    },
    [generatedHtml],
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
          const savedDeck = await persistHtml(html, {
            source: 'upload',
            summary: `Uploaded ${file.name}`,
          })

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

  const handleNewDeck = useCallback(() => {
    startNewDeck()
    void resetChat(null)
    setInput('')
    setError('')
    toast.info('Started a fresh deck')
  }, [resetChat, setError, setInput, startNewDeck])

  const handleSelectDeck = useCallback(
    async (nextDeckId: string) => {
      try {
        await selectDeck(nextDeckId)
        setInput('')
        setError('')
        toast.success('Deck loaded')
      } catch {
        toast.error('Could not load that deck')
      }
    },
    [selectDeck, setError, setInput],
  )

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
    handleRollbackVersion,
    handleSelectDeck,
    handleUploadClick,
  }
}
