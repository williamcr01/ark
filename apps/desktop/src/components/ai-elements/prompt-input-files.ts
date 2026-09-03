import type { FileUIPart } from 'ai'
import { nanoid } from 'nanoid'
import type { ChangeEventHandler, RefObject } from 'react'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

import type { AttachmentsContext } from './prompt-input-context.ts'

export type PromptInputFileError = {
  code: 'max_files' | 'max_file_size' | 'accept'
  message: string
}

export type PromptInputFileLimits = {
  accept?: string
  maxFiles?: number
  maxFileSize?: number
  onError?: (err: PromptInputFileError) => void
}

function fileMatchesAccept(file: File, accept: string | undefined) {
  if (!accept || accept.trim() === '') {
    return true
  }

  const patterns = accept
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  return patterns.some((pattern) => {
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1)
      return file.type.startsWith(prefix)
    }
    return file.type === pattern
  })
}

function attachmentsFromFiles(
  fileList: File[] | FileList,
  currentCount: number,
  limits: PromptInputFileLimits,
): { next: (FileUIPart & { id: string })[]; error?: PromptInputFileError } {
  const incoming = [...fileList]
  const accepted = incoming.filter((file) => fileMatchesAccept(file, limits.accept))
  if (incoming.length && accepted.length === 0) {
    return {
      next: [],
      error: { code: 'accept', message: 'No files match the accepted types.' },
    }
  }

  const sized = accepted.filter((file) =>
    limits.maxFileSize ? file.size <= limits.maxFileSize : true,
  )
  if (accepted.length > 0 && sized.length === 0) {
    return {
      next: [],
      error: { code: 'max_file_size', message: 'All files exceed the maximum size.' },
    }
  }

  const capacity =
    typeof limits.maxFiles === 'number' ? Math.max(0, limits.maxFiles - currentCount) : undefined
  const capped = typeof capacity === 'number' ? sized.slice(0, capacity) : sized
  const error =
    typeof capacity === 'number' && sized.length > capacity
      ? { code: 'max_files' as const, message: 'Too many files. Some were not added.' }
      : undefined

  return {
    error,
    next: capped.map((file) => ({
      filename: file.name,
      id: nanoid(),
      mediaType: file.type,
      type: 'file' as const,
      // react-doctor-disable-next-line react-doctor/no-create-object-url-without-revoke -- object URLs are revoked when the attachment is removed or the input is cleared (remove()/clear() call URL.revokeObjectURL)
      url: URL.createObjectURL(file),
    })),
  }
}

function revokeAttachmentUrls(files: (FileUIPart & { id: string })[]) {
  for (const file of files) {
    if (file.url) {
      URL.revokeObjectURL(file.url)
    }
  }
}

export function usePromptInputFileItems({
  accept,
  maxFiles,
  maxFileSize,
  onError,
}: PromptInputFileLimits) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [items, setItems] = useState<(FileUIPart & { id: string })[]>([])
  const filesRef = useRef(items)

  useEffect(() => {
    filesRef.current = items
  }, [items])

  const openFileDialog = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const add = useCallback(
    (fileList: File[] | FileList) => {
      const { error, next } = attachmentsFromFiles(fileList, filesRef.current.length, {
        accept,
        maxFiles,
        maxFileSize,
      })
      if (error) {
        onError?.(error)
        if (next.length === 0) {
          return
        }
      }
      filesRef.current = [...filesRef.current, ...next]
      setItems(filesRef.current)
    },
    [accept, maxFiles, maxFileSize, onError],
  )

  const remove = useCallback((id: string) => {
    const found = filesRef.current.find((file) => file.id === id)
    if (found?.url) {
      URL.revokeObjectURL(found.url)
    }
    filesRef.current = filesRef.current.filter((file) => file.id !== id)
    setItems(filesRef.current)
  }, [])

  const clear = useCallback(() => {
    revokeAttachmentUrls(filesRef.current)
    filesRef.current = []
    setItems([])
  }, [])

  useEffect(
    () => () => {
      revokeAttachmentUrls(filesRef.current)
    },
    [],
  )

  const handleChange: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => {
      if (event.currentTarget.files) {
        add(event.currentTarget.files)
      }
      event.currentTarget.value = ''
    },
    [add],
  )

  const attachmentsCtx = useMemo<AttachmentsContext>(
    () => ({
      add,
      clear,
      fileInputRef: inputRef,
      files: items,
      openFileDialog,
      remove,
    }),
    [items, add, clear, openFileDialog, remove],
  )

  return { add, attachmentsCtx, clear, handleChange, inputRef, items }
}

export function usePromptInputDrops(
  formRef: RefObject<HTMLFormElement | null>,
  globalDrop: boolean | undefined,
  add: (files: File[] | FileList) => void,
) {
  const addDroppedFiles = useEffectEvent(add)

  useEffect(() => {
    const form = formRef.current
    if (!form || globalDrop) {
      return
    }

    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types?.includes('Files')) {
        event.preventDefault()
      }
    }
    const onDrop = (event: DragEvent) => {
      if (event.dataTransfer?.types?.includes('Files')) {
        event.preventDefault()
      }
      if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
        addDroppedFiles(event.dataTransfer.files)
      }
    }
    form.addEventListener('dragover', onDragOver)
    form.addEventListener('drop', onDrop)
    return () => {
      form.removeEventListener('dragover', onDragOver)
      form.removeEventListener('drop', onDrop)
    }
  }, [formRef, globalDrop])

  useEffect(() => {
    if (!globalDrop) {
      return
    }

    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types?.includes('Files')) {
        event.preventDefault()
      }
    }
    const onDrop = (event: DragEvent) => {
      if (event.dataTransfer?.types?.includes('Files')) {
        event.preventDefault()
      }
      if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
        addDroppedFiles(event.dataTransfer.files)
      }
    }
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [globalDrop])
}
