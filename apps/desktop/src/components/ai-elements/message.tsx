'use client'

import { cn } from '@/lib/ui/utils'
import type { MessageResponseProps as MessageResponseInnerProps } from './message-response'
import type { UIMessage } from 'ai'
import type { HTMLAttributes } from 'react'
import { lazy, Suspense } from 'react'

const LazyMessageResponse = lazy(() =>
  import('./message-response').then((module) => ({
    default: module.MessageResponse,
  })),
)

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage['role']
}

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      'group flex w-full max-w-[95%] flex-col gap-2',
      from === 'user' ? 'is-user ml-auto justify-end' : 'is-assistant',
      className,
    )}
    {...props}
  />
)

export type MessageContentProps = HTMLAttributes<HTMLDivElement>

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      'is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm',
      'group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground',
      'group-[.is-assistant]:text-foreground',
      className,
    )}
    {...props}
  >
    {children}
  </div>
)

export type { MessageResponseProps } from './message-response'

export const MessageResponse = ({ children, className, ...props }: MessageResponseInnerProps) => (
  <Suspense
    fallback={
      <div
        className={cn(
          'size-full whitespace-pre-wrap text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          className,
        )}
      >
        {children}
      </div>
    }
  >
    <LazyMessageResponse className={className} {...props}>
      {children}
    </LazyMessageResponse>
  </Suspense>
)
