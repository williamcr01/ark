'use client'

import type { FileUIPart, SourceDocumentUIPart } from 'ai'
import {
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  Music2Icon,
  PaperclipIcon,
  VideoIcon,
  XIcon,
} from 'lucide-react'
import { AnimatePresence, LayoutGroup, LazyMotion, m, useReducedMotion } from 'motion/react'
import type { HTMLMotionProps } from 'motion/react'
import type { ComponentProps, HTMLAttributes, ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/ui/utils'

export type AttachmentData = (FileUIPart & { id: string }) | (SourceDocumentUIPart & { id: string })

export type AttachmentMediaCategory =
  'image' | 'video' | 'audio' | 'document' | 'source' | 'unknown'

export type AttachmentVariant = 'grid' | 'inline' | 'list'

const CHIP_SPRING = { type: 'spring', stiffness: 700, damping: 46, mass: 0.5 } as const
const CHIP_EXIT = { duration: 0.18, ease: [0.4, 0, 1, 1] } as const
const INSTANT = { duration: 0 } as const
const loadMotionFeatures = () => import('@/lib/ui/motion-features').then((module) => module.default)

const mediaCategoryIcons: Record<AttachmentMediaCategory, typeof ImageIcon> = {
  audio: Music2Icon,
  document: FileTextIcon,
  image: ImageIcon,
  source: GlobeIcon,
  unknown: PaperclipIcon,
  video: VideoIcon,
}

const getMediaCategory = (data: AttachmentData): AttachmentMediaCategory => {
  if (data.type === 'source-document') {
    return 'source'
  }

  const mediaType = data.mediaType ?? ''

  if (mediaType.startsWith('image/')) {
    return 'image'
  }
  if (mediaType.startsWith('video/')) {
    return 'video'
  }
  if (mediaType.startsWith('audio/')) {
    return 'audio'
  }
  if (mediaType.startsWith('application/') || mediaType.startsWith('text/')) {
    return 'document'
  }

  return 'unknown'
}

const getAttachmentLabel = (data: AttachmentData): string => {
  if (data.type === 'source-document') {
    return data.title || data.filename || 'Source'
  }

  const category = getMediaCategory(data)
  return data.filename || (category === 'image' ? 'Image' : 'Attachment')
}

const renderAttachmentImage = (url: string, filename: string | undefined, isGrid: boolean) =>
  isGrid ? (
    <img
      alt={filename || 'Image'}
      className="size-full object-cover"
      height={96}
      src={url}
      width={96}
    />
  ) : (
    <img
      alt={filename || 'Image'}
      className="size-full rounded object-cover"
      height={20}
      src={url}
      width={20}
    />
  )

interface AttachmentsContextValue {
  variant: AttachmentVariant
}

const AttachmentsContext = createContext<AttachmentsContextValue | null>(null)

interface AttachmentContextValue {
  data: AttachmentData
  mediaCategory: AttachmentMediaCategory
  onRemove?: () => void
  variant: AttachmentVariant
}

const AttachmentContext = createContext<AttachmentContextValue | null>(null)

type AttachmentInteractionContextValue = {
  armedId: string | null
  arm: (id: string) => void
  clearArmed: () => void
  register: (id: string, label: string, remove: () => void) => () => void
  remove: (id: string) => boolean
}

const AttachmentInteractionContext = createContext<AttachmentInteractionContextValue | null>(null)

export function AttachmentInteractionProvider({ children }: { children: ReactNode }) {
  const [armedId, setArmedId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const registrations = useRef(new Map<string, { label: string; remove: () => void }>())

  const register = useCallback((id: string, label: string, remove: () => void) => {
    registrations.current.set(id, { label, remove })
    return () => {
      registrations.current.delete(id)
      setArmedId((current) => (current === id ? null : current))
    }
  }, [])

  const arm = useCallback((id: string) => {
    const registration = registrations.current.get(id)
    if (!registration) {
      return
    }
    setArmedId(id)
    setAnnouncement(`${registration.label} selected. Press Backspace again to remove it.`)
  }, [])

  const clearArmed = useCallback(() => setArmedId(null), [])

  const remove = useCallback((id: string) => {
    const registration = registrations.current.get(id)
    if (!registration) {
      return false
    }
    registration.remove()
    setArmedId(null)
    setAnnouncement(`${registration.label} removed.`)
    return true
  }, [])

  const value = useMemo(
    () => ({ armedId, arm, clearArmed, register, remove }),
    [armedId, arm, clearArmed, register, remove],
  )

  return (
    <AttachmentInteractionContext.Provider value={value}>
      {children}
      <span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {announcement}
      </span>
    </AttachmentInteractionContext.Provider>
  )
}

export const useAttachmentInteractions = () => useContext(AttachmentInteractionContext)

const useAttachmentsContext = () => useContext(AttachmentsContext) ?? { variant: 'grid' as const }

const useAttachmentContext = () => {
  const ctx = useContext(AttachmentContext)
  if (!ctx) {
    throw new Error('Attachment components must be used within <Attachment>')
  }
  return ctx
}

export type AttachmentsProps = HTMLAttributes<HTMLDivElement> & {
  variant?: AttachmentVariant
}

export const Attachments = ({
  variant = 'grid',
  className,
  children,
  ...props
}: AttachmentsProps) => {
  const contextValue = useMemo(() => ({ variant }), [variant])

  return (
    <AttachmentsContext.Provider value={contextValue}>
      <LazyMotion features={loadMotionFeatures} strict>
        <LayoutGroup>
          <div
            className={cn(
              'flex items-start',
              variant === 'list' ? 'flex-col gap-2' : 'flex-wrap gap-2',
              variant === 'grid' && 'ml-auto w-fit',
              className,
            )}
            {...props}
          >
            {children}
          </div>
        </LayoutGroup>
      </LazyMotion>
    </AttachmentsContext.Provider>
  )
}

export function AttachmentPresence({ children }: { children: ReactNode }) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {children}
    </AnimatePresence>
  )
}

export type AttachmentProps = HTMLMotionProps<'div'> & {
  data: AttachmentData
  onRemove?: () => void
}

export const Attachment = ({ data, onRemove, className, children, ...props }: AttachmentProps) => {
  const { variant } = useAttachmentsContext()
  const mediaCategory = getMediaCategory(data)
  const interactions = useAttachmentInteractions()
  const registerInteraction = interactions?.register
  const reducedMotion = useReducedMotion()
  const label = getAttachmentLabel(data)
  const armed = interactions?.armedId === data.id

  useEffect(() => {
    if (!onRemove || !registerInteraction) {
      return
    }
    return registerInteraction(data.id, label, onRemove)
  }, [data.id, label, onRemove, registerInteraction])

  const contextValue = useMemo<AttachmentContextValue>(
    () => ({ data, mediaCategory, onRemove, variant }),
    [data, mediaCategory, onRemove, variant],
  )

  return (
    <AttachmentContext.Provider value={contextValue}>
      <m.div
        animate={{ opacity: 1, scale: 1 }}
        className={cn(
          'group relative',
          variant === 'grid' && 'size-24 overflow-hidden rounded-lg',
          variant === 'inline' && [
            'flex h-8 cursor-pointer select-none items-center gap-1.5',
            'rounded-md border border-border px-1.5',
            'text-sm font-medium transition-[background-color,border-color,box-shadow,color] duration-150',
            'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
            armed && 'border-foreground bg-accent text-accent-foreground shadow-sm',
          ],
          variant === 'list' && [
            'flex w-full items-center gap-3 rounded-lg border p-3',
            'hover:bg-accent/50',
          ],
          className,
        )}
        data-armed={armed || undefined}
        data-attachment-dismissible={onRemove ? 'true' : undefined}
        data-attachment-id={data.id}
        exit={
          reducedMotion
            ? { opacity: 0, transition: INSTANT }
            : { opacity: 0, scale: 0.9, transition: CHIP_EXIT }
        }
        initial={reducedMotion ? false : { opacity: 0, scale: 0.9 }}
        layout={reducedMotion ? false : 'position'}
        transition={reducedMotion ? INSTANT : { default: CHIP_SPRING, layout: CHIP_SPRING }}
        {...props}
      >
        {children}
      </m.div>
    </AttachmentContext.Provider>
  )
}

export type AttachmentPreviewProps = HTMLAttributes<HTMLDivElement> & {
  fallbackIcon?: ReactNode
}

export const AttachmentPreview = ({
  fallbackIcon,
  className,
  ...props
}: AttachmentPreviewProps) => {
  const { data, mediaCategory, variant } = useAttachmentContext()

  const iconSize = variant === 'inline' ? 'size-3' : 'size-4'

  const renderIcon = (Icon: typeof ImageIcon) => (
    <Icon className={cn(iconSize, 'text-muted-foreground')} />
  )

  const renderContent = () => {
    if (mediaCategory === 'image' && data.type === 'file' && data.url) {
      return renderAttachmentImage(data.url, data.filename, variant === 'grid')
    }

    if (mediaCategory === 'video' && data.type === 'file' && data.url) {
      return <video className="size-full object-cover" muted src={data.url} />
    }

    const Icon = mediaCategoryIcons[mediaCategory]
    return fallbackIcon ?? renderIcon(Icon)
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden',
        variant === 'grid' && 'size-full bg-muted',
        variant === 'inline' && 'size-5 rounded bg-background',
        variant === 'list' && 'size-12 rounded bg-muted',
        className,
      )}
      {...props}
    >
      {renderContent()}
    </div>
  )
}

export type AttachmentInfoProps = HTMLAttributes<HTMLDivElement> & {
  showMediaType?: boolean
}

export const AttachmentInfo = ({
  showMediaType = false,
  className,
  ...props
}: AttachmentInfoProps) => {
  const { data, variant } = useAttachmentContext()
  const label = getAttachmentLabel(data)

  if (variant === 'grid') {
    return null
  }

  return (
    <div className={cn('min-w-0 flex-1', className)} {...props}>
      <span className="block truncate">{label}</span>
      {showMediaType && data.mediaType ? (
        <span className="block truncate text-muted-foreground text-xs">{data.mediaType}</span>
      ) : null}
    </div>
  )
}

export type AttachmentRemoveProps = ComponentProps<typeof Button> & {
  label?: string
}

export const AttachmentRemove = ({
  label = 'Remove',
  className,
  children,
  ...props
}: AttachmentRemoveProps) => {
  const { data, onRemove, variant } = useAttachmentContext()
  const interactions = useAttachmentInteractions()

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!interactions?.remove(data.id)) {
        onRemove?.()
      }
    },
    [data.id, interactions, onRemove],
  )

  if (!onRemove) {
    return null
  }

  return (
    <Button
      aria-label={label}
      className={cn(
        variant === 'grid' && [
          'absolute top-2 right-2 size-6 rounded-full p-0',
          'bg-background/80 backdrop-blur-sm',
          'opacity-0 transition-opacity group-hover:opacity-100',
          'hover:bg-background',
          '[&>svg]:size-3',
        ],
        variant === 'inline' && [
          'size-5 rounded p-0',
          'opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
          '[&>svg]:size-2.5',
        ],
        variant === 'list' && ['size-8 shrink-0 rounded p-0', '[&>svg]:size-4'],
        className,
      )}
      onClick={handleClick}
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <XIcon />}
      <span className="sr-only">{label}</span>
    </Button>
  )
}
