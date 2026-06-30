'use client'

import { cn } from '@/lib/utils'
import { memo, useEffect, useState, type ComponentProps } from 'react'
import { Streamdown } from 'streamdown'

export type MessageResponseProps = ComponentProps<typeof Streamdown>

type StreamdownPlugins = NonNullable<MessageResponseProps['plugins']>

const loadStreamdownPlugins = (): Promise<StreamdownPlugins> =>
  Promise.all([
    import('@streamdown/cjk'),
    import('@streamdown/code'),
    import('@streamdown/math'),
    import('@streamdown/mermaid'),
  ]).then(([cjk, code, math, mermaid]) => ({
    cjk: cjk.cjk,
    code: code.code,
    math: math.math,
    mermaid: mermaid.mermaid,
  }))

let streamdownPluginsPromise: Promise<StreamdownPlugins> | null = null

function getStreamdownPlugins() {
  streamdownPluginsPromise ??= loadStreamdownPlugins()
  return streamdownPluginsPromise
}

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => {
    const [plugins, setPlugins] = useState<StreamdownPlugins | null>(null)

    useEffect(() => {
      let cancelled = false

      void getStreamdownPlugins().then((loadedPlugins) => {
        if (!cancelled) {
          setPlugins(loadedPlugins)
        }
      })

      return () => {
        cancelled = true
      }
    }, [])

    return (
      <Streamdown
        className={cn('size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}
        plugins={plugins ?? undefined}
        {...props}
      />
    )
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children && nextProps.isAnimating === prevProps.isAnimating,
)

MessageResponse.displayName = 'MessageResponse'
