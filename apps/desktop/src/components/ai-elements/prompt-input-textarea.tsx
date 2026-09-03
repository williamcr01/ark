import { InputGroupTextarea } from '@/components/ui/input-group'
import { cn } from '@/lib/ui/utils'
import type {
  ClipboardEventHandler,
  ComponentProps,
  KeyboardEventHandler,
  KeyboardEvent,
} from 'react'
import { useCallback, useRef } from 'react'

import { useAttachmentInteractions } from './attachments'
import { usePromptInputAttachments } from './prompt-input-context.ts'

export type PromptInputTextareaProps = ComponentProps<typeof InputGroupTextarea>

function attachmentIdsInForm(textarea: HTMLTextAreaElement) {
  return [
    ...(textarea.form?.querySelectorAll<HTMLElement>('[data-attachment-dismissible="true"]') ?? []),
  ]
    .map((item) => item.dataset.attachmentId)
    .filter((id): id is string => Boolean(id))
}

function handleEmptyValueAttachmentKeys(
  event: KeyboardEvent<HTMLTextAreaElement>,
  interactions: NonNullable<ReturnType<typeof useAttachmentInteractions>>,
  ids: string[],
) {
  if (event.key === 'Backspace' && ids.length > 0) {
    event.preventDefault()
    if (event.repeat) {
      return
    }
    if (interactions.armedId) {
      interactions.remove(interactions.armedId)
    } else {
      interactions.arm(ids.at(-1)!)
    }
    return
  }

  if (event.key === 'Delete' && interactions.armedId) {
    event.preventDefault()
    if (event.repeat) {
      return
    }
    interactions.remove(interactions.armedId)
    return
  }

  if (
    event.key === 'ArrowLeft' &&
    event.currentTarget.selectionStart === 0 &&
    event.currentTarget.selectionEnd === 0
  ) {
    if (ids.length === 0) {
      return
    }
    event.preventDefault()
    const currentIndex = interactions.armedId ? ids.indexOf(interactions.armedId) : ids.length
    interactions.arm(ids[Math.max(0, currentIndex - 1)])
    return
  }

  if (event.key === 'ArrowRight' && interactions.armedId) {
    event.preventDefault()
    const currentIndex = ids.indexOf(interactions.armedId)
    const nextId = ids[currentIndex + 1]
    if (nextId) {
      interactions.arm(nextId)
    } else {
      interactions.clearArmed()
    }
    return
  }

  if (event.key === 'Escape' && interactions.armedId) {
    event.preventDefault()
    interactions.clearArmed()
  }
}

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

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      onKeyDown?.(event)
      if (event.defaultPrevented) {
        return
      }

      if (event.key === 'Enter') {
        if (isComposingRef.current || event.nativeEvent.isComposing) {
          return
        }
        if (event.shiftKey) {
          return
        }
        event.preventDefault()
        const { form } = event.currentTarget
        const submitButton = form?.querySelector(
          'button[type="submit"]',
        ) as HTMLButtonElement | null
        if (submitButton?.disabled) {
          return
        }
        form?.requestSubmit()
        return
      }

      if (!interactions || event.currentTarget.value !== '') {
        return
      }

      handleEmptyValueAttachmentKeys(event, interactions, attachmentIdsInForm(event.currentTarget))
    },
    [interactions, onKeyDown],
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

  return (
    <InputGroupTextarea
      className={cn('field-sizing-content max-h-48 min-h-16', className)}
      name="message"
      onBlur={handleBlur}
      onChange={handleChange}
      onCompositionEnd={() => {
        isComposingRef.current = false
      }}
      onCompositionStart={() => {
        isComposingRef.current = true
      }}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={placeholder}
      {...props}
    />
  )
}
