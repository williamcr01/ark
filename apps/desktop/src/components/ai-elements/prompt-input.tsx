'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import {
  AttachmentInteractionProvider,
  useAttachmentInteractions,
} from '@/components/ai-elements/attachments'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ChatStatus, FileUIPart } from 'ai'
import { ArrowUpIcon, ImageIcon, Monitor, PlusIcon, SquareIcon, XIcon } from 'lucide-react'
import { nanoid } from 'nanoid'
import type {
  ChangeEventHandler,
  ClipboardEventHandler,
  ComponentProps,
  FormEvent,
  FormEventHandler,
  HTMLAttributes,
  KeyboardEventHandler,
  ReactNode,
  RefObject,
} from 'react'
import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'

// ============================================================================
// Helpers
// ============================================================================

const convertBlobUrlToDataUrl = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return null
    }
    const blob = await response.blob()
    // FileReader uses callback-based API, wrapping in Promise is necessary
    // oxlint-disable-next-line eslint-plugin-promise(avoid-new)
    return new Promise((resolve) => {
      const reader = new FileReader()
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      reader.onloadend = () => resolve(reader.result as string)
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

const captureScreenshot = async (): Promise<File | null> => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    return null
  }

  let stream: MediaStream | null = null
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true

  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: true,
    })

    video.srcObject = stream

    // Video element uses callback-based API, wrapping in Promise is necessary
    // oxlint-disable-next-line eslint-plugin-promise(avoid-new)
    await new Promise<void>((resolve, reject) => {
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      video.onloadedmetadata = () => resolve()
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      video.onerror = () => reject(new Error('Failed to load screen stream'))
    })

    await video.play()

    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) {
      return null
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      return null
    }

    context.drawImage(video, 0, 0, width, height)
    // canvas.toBlob uses callback-based API, wrapping in Promise is necessary
    // oxlint-disable-next-line eslint-plugin-promise(avoid-new)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png')
    })
    if (!blob) {
      return null
    }

    const timestamp = new Date()
      .toISOString()
      .replaceAll(/[:.]/g, '-')
      .replace('T', '_')
      .replace('Z', '')

    return new File([blob], `screenshot-${timestamp}.png`, {
      lastModified: Date.now(),
      type: 'image/png',
    })
  } finally {
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop()
      }
    }
    video.pause()
    video.srcObject = null
  }
}

// ============================================================================
// Attachment Context
// ============================================================================

export interface AttachmentsContext {
  files: (FileUIPart & { id: string })[]
  add: (files: File[] | FileList) => void
  remove: (id: string) => void
  clear: () => void
  openFileDialog: () => void
  fileInputRef: RefObject<HTMLInputElement | null>
}

const LocalAttachmentsContext = createContext<AttachmentsContext | null>(null)

export const usePromptInputAttachments = () => {
  const context = useContext(LocalAttachmentsContext)
  if (!context) {
    throw new Error('usePromptInputAttachments must be used within a PromptInput')
  }
  return context
}

export type PromptInputActionAddAttachmentsProps = ComponentProps<typeof DropdownMenuItem> & {
  label?: string
}

export const PromptInputActionAddAttachments = ({
  label = 'Add photos or files',
  ...props
}: PromptInputActionAddAttachmentsProps) => {
  const attachments = usePromptInputAttachments()

  const handleSelect = useCallback(
    (e: Event) => {
      e.preventDefault()
      attachments.openFileDialog()
    },
    [attachments],
  )

  return (
    <DropdownMenuItem {...props} onSelect={handleSelect}>
      <ImageIcon className="mr-2 size-4" /> {label}
    </DropdownMenuItem>
  )
}

export type PromptInputActionAddScreenshotProps = ComponentProps<typeof DropdownMenuItem> & {
  label?: string
}

export const PromptInputActionAddScreenshot = ({
  label = 'Take screenshot',
  onSelect,
  ...props
}: PromptInputActionAddScreenshotProps) => {
  const attachments = usePromptInputAttachments()

  const handleSelect = useCallback(
    async (event: Event) => {
      onSelect?.(event)
      if (event.defaultPrevented) {
        return
      }

      try {
        const screenshot = await captureScreenshot()
        if (screenshot) {
          attachments.add([screenshot])
        }
      } catch (error) {
        if (
          error instanceof DOMException &&
          (error.name === 'NotAllowedError' || error.name === 'AbortError')
        ) {
          return
        }
        throw error
      }
    },
    [onSelect, attachments],
  )

  return (
    <DropdownMenuItem {...props} onSelect={handleSelect}>
      <Monitor className="mr-2 size-4" />
      {label}
    </DropdownMenuItem>
  )
}

export interface PromptInputMessage {
  text: string
  files: FileUIPart[]
}

export type PromptInputProps = Omit<HTMLAttributes<HTMLFormElement>, 'onSubmit' | 'onError'> & {
  // e.g., "image/*" or leave undefined for any
  accept?: string
  multiple?: boolean
  // When true, accepts drops anywhere on document. Default false (opt-in).
  globalDrop?: boolean
  // Render a hidden input with given name and keep it in sync for native form posts. Default false.
  syncHiddenInput?: boolean
  // Minimal constraints
  maxFiles?: number
  // bytes
  maxFileSize?: number
  onError?: (err: { code: 'max_files' | 'max_file_size' | 'accept'; message: string }) => void
  onSubmit: (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => void | Promise<void>
  /**
   * Classes for the bordered group rather than the wrapping form. Surface styling
   * belongs here: the form is unstyled and sits behind the group's rounded corners,
   * so a background set through `className` shows through them as square edges.
   */
  groupClassName?: string
}

export const PromptInput = ({
  className,
  groupClassName,
  accept,
  multiple,
  globalDrop,
  syncHiddenInput,
  maxFiles,
  maxFileSize,
  onError,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const [items, setItems] = useState<(FileUIPart & { id: string })[]>([])
  const filesRef = useRef(items)

  useEffect(() => {
    filesRef.current = items
  }, [items])

  const openFileDialog = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const matchesAccept = useCallback(
    (f: File) => {
      if (!accept || accept.trim() === '') {
        return true
      }

      const patterns = accept
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      return patterns.some((pattern) => {
        if (pattern.endsWith('/*')) {
          // e.g: image/* -> image/
          const prefix = pattern.slice(0, -1)
          return f.type.startsWith(prefix)
        }
        return f.type === pattern
      })
    },
    [accept],
  )

  const add = useCallback(
    (fileList: File[] | FileList) => {
      const incoming = [...fileList]
      const accepted = incoming.filter((f) => matchesAccept(f))
      if (incoming.length && accepted.length === 0) {
        onError?.({
          code: 'accept',
          message: 'No files match the accepted types.',
        })
        return
      }
      const withinSize = (f: File) => (maxFileSize ? f.size <= maxFileSize : true)
      const sized = accepted.filter(withinSize)
      if (accepted.length > 0 && sized.length === 0) {
        onError?.({
          code: 'max_file_size',
          message: 'All files exceed the maximum size.',
        })
        return
      }

      const capacity =
        typeof maxFiles === 'number' ? Math.max(0, maxFiles - filesRef.current.length) : undefined
      const capped = typeof capacity === 'number' ? sized.slice(0, capacity) : sized

      if (typeof capacity === 'number' && sized.length > capacity) {
        onError?.({
          code: 'max_files',
          message: 'Too many files. Some were not added.',
        })
      }

      const next = capped.map((file) => ({
        filename: file.name,
        id: nanoid(),
        mediaType: file.type,
        type: 'file' as const,
        url: URL.createObjectURL(file),
      }))
      filesRef.current = [...filesRef.current, ...next]
      setItems(filesRef.current)
    },
    [matchesAccept, maxFiles, maxFileSize, onError],
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
    for (const file of filesRef.current) {
      if (file.url) {
        URL.revokeObjectURL(file.url)
      }
    }
    filesRef.current = []
    setItems([])
  }, [])
  const addDroppedFiles = useEffectEvent(add)

  // Note: File input cannot be programmatically set for security reasons
  // The syncHiddenInput prop is no longer functional
  useEffect(() => {
    if (syncHiddenInput && inputRef.current && items.length === 0) {
      inputRef.current.value = ''
    }
  }, [items, syncHiddenInput])

  // Attach drop handlers on nearest form and document (opt-in)
  useEffect(() => {
    const form = formRef.current
    if (!form) {
      return
    }
    if (globalDrop) {
      // when global drop is on, let the document-level handler own drops
      return
    }

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
      }
    }
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        addDroppedFiles(e.dataTransfer.files)
      }
    }
    form.addEventListener('dragover', onDragOver)
    form.addEventListener('drop', onDrop)
    return () => {
      form.removeEventListener('dragover', onDragOver)
      form.removeEventListener('drop', onDrop)
    }
  }, [globalDrop])

  useEffect(() => {
    if (!globalDrop) {
      return
    }

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
      }
    }
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        addDroppedFiles(e.dataTransfer.files)
      }
    }
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [globalDrop])

  useEffect(
    () => () => {
      for (const file of filesRef.current) {
        if (file.url) {
          URL.revokeObjectURL(file.url)
        }
      }
    },
    [],
  )

  const handleChange: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => {
      if (event.currentTarget.files) {
        add(event.currentTarget.files)
      }
      // Reset input value to allow selecting files that were previously removed
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

  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault()

      const form = event.currentTarget
      const formData = new FormData(form)
      const text = (formData.get('message') as string) || ''

      // Reset form immediately after capturing text to avoid race condition
      // where user input during async blob conversion would be lost
      form.reset()

      try {
        // Convert blob URLs to data URLs asynchronously
        const convertedFiles: FileUIPart[] = await Promise.all(
          items.map(async ({ id: _id, ...item }) => {
            if (item.url?.startsWith('blob:')) {
              const dataUrl = await convertBlobUrlToDataUrl(item.url)
              // If conversion failed, keep the original blob URL
              return {
                ...item,
                url: dataUrl ?? item.url,
              }
            }
            return item
          }),
        )

        const result = onSubmit({ files: convertedFiles, text }, event)

        // Handle both sync and async onSubmit
        if (result instanceof Promise) {
          try {
            await result
            clear()
          } catch {
            // Don't clear on error - user may want to retry
          }
        } else {
          // Sync function completed without throwing, clear inputs
          clear()
        }
      } catch {
        // Don't clear on error - user may want to retry
      }
    },
    [items, onSubmit, clear],
  )

  return (
    <LocalAttachmentsContext.Provider value={attachmentsCtx}>
      <AttachmentInteractionProvider>
        <input
          accept={accept}
          aria-label="Upload files"
          className="hidden"
          multiple={multiple}
          onChange={handleChange}
          ref={inputRef}
          title="Upload files"
          type="file"
        />
        <form className={cn('w-full', className)} onSubmit={handleSubmit} ref={formRef} {...props}>
          <InputGroup
            className={cn(
              'overflow-hidden transition-colors focus-within:border-foreground/25',
              groupClassName,
            )}
          >
            {children}
          </InputGroup>
        </form>
      </AttachmentInteractionProvider>
    </LocalAttachmentsContext.Provider>
  )
}

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>

export const PromptInputBody = ({ className, ...props }: PromptInputBodyProps) => (
  <div className={cn('contents', className)} {...props} />
)

export type PromptInputTextareaProps = ComponentProps<typeof InputGroupTextarea>

export const PromptInputTextarea = ({
  onBlur,
  onChange,
  onKeyDown,
  className,
  placeholder = 'What would you like to know?',
  ...props
}: PromptInputTextareaProps) => {
  const attachments = usePromptInputAttachments()
  const interactions = useAttachmentInteractions()
  const isComposingRef = useRef(false)

  const getAttachmentIds = useCallback(
    (textarea: HTMLTextAreaElement) =>
      [
        ...(textarea.form?.querySelectorAll<HTMLElement>('[data-attachment-dismissible="true"]') ??
          []),
      ]
        .map((item) => item.dataset.attachmentId)
        .filter((id): id is string => Boolean(id)),
    [],
  )

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
    (e) => {
      // Call the external onKeyDown handler first
      onKeyDown?.(e)

      // If the external handler prevented default, don't run internal logic
      if (e.defaultPrevented) {
        return
      }

      if (e.key === 'Enter') {
        if (isComposingRef.current || e.nativeEvent.isComposing) {
          return
        }
        if (e.shiftKey) {
          return
        }
        e.preventDefault()

        // Check if the submit button is disabled before submitting
        const { form } = e.currentTarget
        const submitButton = form?.querySelector(
          'button[type="submit"]',
        ) as HTMLButtonElement | null
        if (submitButton?.disabled) {
          return
        }

        form?.requestSubmit()
      }

      if (!interactions || e.currentTarget.value !== '') {
        return
      }

      const ids = getAttachmentIds(e.currentTarget)

      if (e.key === 'Backspace' && ids.length > 0) {
        e.preventDefault()
        if (e.repeat) {
          return
        }
        if (interactions.armedId) {
          interactions.remove(interactions.armedId)
        } else {
          interactions.arm(ids.at(-1)!)
        }
        return
      }

      if (e.key === 'Delete' && interactions.armedId) {
        e.preventDefault()
        if (e.repeat) {
          return
        }
        interactions.remove(interactions.armedId)
        return
      }

      if (
        e.key === 'ArrowLeft' &&
        e.currentTarget.selectionStart === 0 &&
        e.currentTarget.selectionEnd === 0
      ) {
        if (ids.length === 0) {
          return
        }
        e.preventDefault()
        const currentIndex = interactions.armedId ? ids.indexOf(interactions.armedId) : ids.length
        interactions.arm(ids[Math.max(0, currentIndex - 1)])
        return
      }

      if (e.key === 'ArrowRight' && interactions.armedId) {
        e.preventDefault()
        const currentIndex = ids.indexOf(interactions.armedId)
        const nextId = ids[currentIndex + 1]
        if (nextId) {
          interactions.arm(nextId)
        } else {
          interactions.clearArmed()
        }
        return
      }

      if (e.key === 'Escape' && interactions.armedId) {
        e.preventDefault()
        interactions.clearArmed()
      }
    },
    [getAttachmentIds, interactions, onKeyDown],
  )

  const handleBlur = useCallback<NonNullable<PromptInputTextareaProps['onBlur']>>(
    (event) => {
      interactions?.clearArmed()
      onBlur?.(event)
    },
    [interactions, onBlur],
  )

  const handleChange = useCallback<NonNullable<PromptInputTextareaProps['onChange']>>(
    (event) => {
      interactions?.clearArmed()
      onChange?.(event)
    },
    [interactions, onChange],
  )

  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      const items = event.clipboardData?.items

      if (!items) {
        return
      }

      const files: File[] = []

      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) {
            files.push(file)
          }
        }
      }

      if (files.length > 0) {
        event.preventDefault()
        attachments.add(files)
      }
    },
    [attachments],
  )

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false
  }, [])
  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true
  }, [])

  return (
    <InputGroupTextarea
      className={cn('field-sizing-content max-h-48 min-h-16', className)}
      name="message"
      onBlur={handleBlur}
      onChange={handleChange}
      onCompositionEnd={handleCompositionEnd}
      onCompositionStart={handleCompositionStart}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={placeholder}
      {...props}
    />
  )
}

export type PromptInputHeaderProps = Omit<ComponentProps<typeof InputGroupAddon>, 'align'>

export const PromptInputHeader = ({ className, ...props }: PromptInputHeaderProps) => (
  <InputGroupAddon
    align="block-end"
    className={cn('order-first flex-wrap gap-1', className)}
    {...props}
  />
)

export type PromptInputFooterProps = Omit<ComponentProps<typeof InputGroupAddon>, 'align'>

export const PromptInputFooter = ({ className, ...props }: PromptInputFooterProps) => (
  <InputGroupAddon
    align="block-end"
    className={cn('justify-between gap-1', className)}
    {...props}
  />
)

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>

export const PromptInputTools = ({ className, ...props }: PromptInputToolsProps) => (
  <div className={cn('flex min-w-0 items-center gap-1', className)} {...props} />
)

export type PromptInputButtonTooltip =
  | string
  | {
      content: ReactNode
      shortcut?: string
      side?: ComponentProps<typeof TooltipContent>['side']
    }

export type PromptInputButtonProps = ComponentProps<typeof InputGroupButton> & {
  tooltip?: PromptInputButtonTooltip
}

export const PromptInputButton = ({
  variant = 'ghost',
  className,
  size,
  tooltip,
  ...props
}: PromptInputButtonProps) => {
  const newSize = size ?? (Children.count(props.children) > 1 ? 'sm' : 'icon-sm')

  const button = (
    <InputGroupButton
      className={cn(className)}
      size={newSize}
      type="button"
      variant={variant}
      {...props}
    />
  )

  if (!tooltip) {
    return button
  }

  const tooltipContent = typeof tooltip === 'string' ? tooltip : tooltip.content
  const shortcut = typeof tooltip === 'string' ? undefined : tooltip.shortcut
  const side = typeof tooltip === 'string' ? 'top' : (tooltip.side ?? 'top')

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side={side}>
        {tooltipContent}
        {shortcut && <span className="ml-2 text-muted-foreground">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

export type PromptInputActionMenuProps = ComponentProps<typeof DropdownMenu>
export const PromptInputActionMenu = (props: PromptInputActionMenuProps) => (
  <DropdownMenu {...props} />
)

export type PromptInputActionMenuTriggerProps = PromptInputButtonProps

export const PromptInputActionMenuTrigger = ({
  className,
  children,
  ...props
}: PromptInputActionMenuTriggerProps) => (
  <DropdownMenuTrigger asChild>
    <PromptInputButton className={className} {...props}>
      {children ?? <PlusIcon className="size-4" />}
    </PromptInputButton>
  </DropdownMenuTrigger>
)

export type PromptInputActionMenuContentProps = ComponentProps<typeof DropdownMenuContent>
export const PromptInputActionMenuContent = ({
  className,
  ...props
}: PromptInputActionMenuContentProps) => (
  <DropdownMenuContent align="start" className={cn(className)} {...props} />
)

// Note: Actions that perform side-effects (like opening a file dialog)
// are provided in opt-in modules (e.g., prompt-input-attachments).

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: ChatStatus
  onStop?: () => void
}

export const PromptInputSubmit = ({
  className,
  variant = 'default',
  size = 'icon-sm',
  status,
  onStop,
  onClick,
  children,
  ...props
}: PromptInputSubmitProps) => {
  const isGenerating = status === 'submitted' || status === 'streaming'

  let Icon = <ArrowUpIcon className="size-4" />

  if (status === 'submitted') {
    Icon = <Spinner />
  } else if (status === 'streaming') {
    Icon = <SquareIcon className="size-4" />
  } else if (status === 'error') {
    Icon = <XIcon className="size-4" />
  }

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (isGenerating && onStop) {
        e.preventDefault()
        onStop()
        return
      }
      onClick?.(e)
    },
    [isGenerating, onStop, onClick],
  )

  return (
    <InputGroupButton
      aria-label={isGenerating ? 'Stop' : 'Submit'}
      className={cn(className)}
      onClick={handleClick}
      size={size}
      type={isGenerating && onStop ? 'button' : 'submit'}
      variant={variant}
      {...props}
    >
      {children ?? Icon}
    </InputGroupButton>
  )
}
