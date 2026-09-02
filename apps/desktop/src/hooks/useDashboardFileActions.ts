import { useCallback, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'

import { clearStoredGenerationJob } from '@/hooks/useGenerationJob'
import { clearChatSession } from '@/lib/chat/chat-session'
import { createDeck, importPptx, openWorkspace } from '@/lib/api/deck-api'
import {
  basenameFromPath,
  describeDeckValidation,
  fileToBase64,
  isHtmlDeckFile,
  isLegacyPptFile,
  isPptxFile,
  PPTX_LEGACY_UPLOAD_MESSAGE,
  validateUploadedDeck,
} from '@/lib/deck/deck-io'

export type DashboardFileActions = {
  refs: {
    fileInputRef: RefObject<HTMLInputElement | null>
    pptxFileInputRef: RefObject<HTMLInputElement | null>
  }
  isUploading: boolean
  handleNewDeck: () => void
  handleOpenWorkspace: () => Promise<void>
  handleUploadClick: () => void
  handlePptxImportClick: () => void
  handleHtmlUpload: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  handlePptxUpload: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
}

export function useDashboardFileActions(): DashboardFileActions {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pptxFileInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handlePptxImportClick = useCallback(() => {
    pptxFileInputRef.current?.click()
  }, [])

  const handleNewDeck = useCallback(() => {
    clearChatSession(null)
    clearStoredGenerationJob(null)
    navigate('/')
  }, [navigate])

  const handleOpenWorkspace = useCallback(async () => {
    const path = await window.arkDesktop.files.openWorkspace()
    if (!path) return
    if (isPptxFile(path) || isLegacyPptFile(path)) {
      const filename = basenameFromPath(path)
      const pending = toast.loading('Importing PowerPoint...')
      try {
        const deck = await importPptx({ path, filename })
        toast.success(`Imported ${filename}`, { id: pending })
        navigate(`/decks/${deck.id}`)
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Could not import that PowerPoint file',
          { id: pending },
        )
      }
      return
    }
    const deck = await openWorkspace(path)
    navigate(`/decks/${deck.id}`)
  }, [navigate])

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

      setIsUploading(true)

      try {
        const html = await file.text()
        const validation = validateUploadedDeck(html)

        if (!validation.valid) {
          const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')
          toast.error(primaryIssue?.message ?? 'That file does not look like a valid Ark HTML deck')
          return
        }

        const deck = await createDeck(html)
        toast.success(`Loaded ${file.name}. ${describeDeckValidation(validation)}.`)
        navigate(`/decks/${deck.id}`)
      } catch {
        toast.error('Could not upload that HTML file')
      } finally {
        setIsUploading(false)
      }
    },
    [navigate],
  )

  const handlePptxUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''

      if (!file) {
        return
      }

      if (isLegacyPptFile(file)) {
        toast.error(PPTX_LEGACY_UPLOAD_MESSAGE)
        return
      }

      if (!isPptxFile(file)) {
        toast.error('Import a .pptx file')
        return
      }

      setIsUploading(true)

      try {
        const deck = await importPptx({ filename: file.name, bytes: await fileToBase64(file) })
        toast.success(`Imported ${file.name}`)
        navigate(`/decks/${deck.id}`)
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Could not import that PowerPoint file',
        )
      } finally {
        setIsUploading(false)
      }
    },
    [navigate],
  )

  return {
    refs: { fileInputRef, pptxFileInputRef },
    isUploading,
    handleNewDeck,
    handleOpenWorkspace,
    handleUploadClick,
    handlePptxImportClick,
    handleHtmlUpload,
    handlePptxUpload,
  }
}
