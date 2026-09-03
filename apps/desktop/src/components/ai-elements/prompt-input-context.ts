import type { FileUIPart } from 'ai'
import { createContext, useContext, type RefObject } from 'react'

export interface AttachmentsContext {
  files: (FileUIPart & { id: string })[]
  add: (files: File[] | FileList) => void
  remove: (id: string) => void
  clear: () => void
  openFileDialog: () => void
  fileInputRef: RefObject<HTMLInputElement | null>
}

export const LocalAttachmentsContext = createContext<AttachmentsContext | null>(null)

export const usePromptInputAttachments = () => {
  const context = useContext(LocalAttachmentsContext)
  if (!context) {
    throw new Error('usePromptInputAttachments must be used within a PromptInput')
  }
  return context
}
