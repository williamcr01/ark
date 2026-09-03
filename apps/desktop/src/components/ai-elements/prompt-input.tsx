'use client'

import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupButton } from '@/components/ui/input-group'
import { AttachmentInteractionProvider } from '@/components/ai-elements/attachments'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/ui/utils'
import type { ChatStatus, FileUIPart } from 'ai'
import { ArrowUpIcon, PlusIcon, SquareIcon, XIcon } from 'lucide-react'
import type {
  ComponentProps,
  FormEvent,
  FormEventHandler,
  HTMLAttributes,
  MouseEvent,
  ReactNode,
} from 'react'
import { Children, useCallback, useEffect, useRef } from 'react'

import { convertBlobUrlToDataUrl } from './prompt-input-capture.ts'
import { LocalAttachmentsContext, usePromptInputAttachments } from './prompt-input-context.ts'
import { usePromptInputDrops, usePromptInputFileItems } from './prompt-input-files.ts'

export type { AttachmentsContext } from './prompt-input-context.ts'
export { usePromptInputAttachments }
export {
  PromptInputActionAddAttachments,
  type PromptInputActionAddAttachmentsProps,
  PromptInputActionAddScreenshot,
  type PromptInputActionAddScreenshotProps,
} from './prompt-input-add-actions.tsx'
export { PromptInputTextarea, type PromptInputTextareaProps } from './prompt-input-textarea.tsx'

export interface PromptInputMessage {
  text: string
  files: FileUIPart[]
}

export type PromptInputProps = Omit<HTMLAttributes<HTMLFormElement>, 'onSubmit' | 'onError'> & {
  accept?: string
  multiple?: boolean
  globalDrop?: boolean
  syncHiddenInput?: boolean
  maxFiles?: number
  maxFileSize?: number
  onError?: (err: { code: 'max_files' | 'max_file_size' | 'accept'; message: string }) => void
  onSubmit: (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => void | Promise<void>
  groupClassName?: string
}

async function filesForSubmit(items: (FileUIPart & { id: string })[]) {
  return Promise.all(
    items.map(async ({ id: _id, ...item }) => {
      if (item.url?.startsWith('blob:')) {
        const dataUrl = await convertBlobUrlToDataUrl(item.url)
        return {
          ...item,
          url: dataUrl ?? item.url,
        }
      }
      return item
    }),
  )
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
  const formRef = useRef<HTMLFormElement | null>(null)
  const { add, attachmentsCtx, clear, handleChange, inputRef, items } = usePromptInputFileItems({
    accept,
    maxFiles,
    maxFileSize,
    onError,
  })
  usePromptInputDrops(formRef, globalDrop, add)

  useEffect(() => {
    if (syncHiddenInput && inputRef.current && items.length === 0) {
      inputRef.current.value = ''
    }
  }, [inputRef, items, syncHiddenInput])

  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault()
      const form = event.currentTarget
      const formData = new FormData(form)
      const text = (formData.get('message') as string) || ''
      form.reset()

      try {
        const convertedFiles = await filesForSubmit(items)
        const result = onSubmit({ files: convertedFiles, text }, event)
        if (result instanceof Promise) {
          try {
            await result
            clear()
          } catch {
            // Keep attachments so the user can retry.
          }
        } else {
          clear()
        }
      } catch {
        // Keep attachments so the user can retry.
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
    (event: MouseEvent<HTMLButtonElement>) => {
      if (isGenerating && onStop) {
        event.preventDefault()
        onStop()
        return
      }
      onClick?.(event)
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
