import { type MutableRefObject, type ReactNode, type RefObject } from 'react'

import { DeckPreviewStatusOverlays } from '@/components/DeckPreviewStatusOverlays'
import {
  getPreviewFrameStyle,
  getPreviewSandbox,
  getPreviewStageStyle,
  PREVIEW_IFRAME_SECURITY_PROPS,
} from '@/lib/deck/deck-preview'
import { cn } from '@/lib/ui/utils'
import type { DeckPreviewFrameModel } from '@/hooks/useDeckPreviewFrame'
import type { PreviewBridgeSessionResult } from '@/hooks/usePreviewBridgeSession'
import type { EditorTool } from '@ark/editor-runtime'
import type { RuntimeErrorNotice } from '@/lib/deck/runtime-error-reporting.ts'
import type { DeckRuntimeMode } from '@ark/runtime-registry/deck-runtime.ts'
import { Skeleton } from '@/components/ui/skeleton'
import { useChatStore } from '@/state/chat-store.ts'
import { useDeckStore } from '@/state/deck-store.ts'

export type DeckPreviewFrameProps = {
  children?: ReactNode
  editor: {
    active: boolean
    activeTool: EditorTool
    editorError: string | null
    enableEditor: (slideIndex: number, tool: EditorTool, scale?: number) => boolean
  }
  frame: {
    iframeRef: RefObject<HTMLIFrameElement | null>
    model: DeckPreviewFrameModel
    scale: number
    stageRef: RefObject<HTMLDivElement | null>
  }
  navigation: {
    activeSlideIndexRef: MutableRefObject<number>
    goToSlide: (index: number) => void
  }
  presentOpen: boolean
  runtime: {
    mode: DeckRuntimeMode
    networkIssue?: string
    onDismissRuntimeError: () => void
    runtimeError: RuntimeErrorNotice | null
    usesStaticPreview: boolean
  }
  session: PreviewBridgeSessionResult
}

export function DeckPreviewFrame({
  children,
  editor,
  frame,
  navigation,
  presentOpen,
  runtime,
  session,
}: DeckPreviewFrameProps) {
  const isPreviewUpdating = useChatStore((state) => state.isPreviewUpdating)
  const deckId = useDeckStore((state) => state.deckId)
  const documentRevision = useDeckStore((state) => state.documentRevision)
  const previewStageStyle = getPreviewStageStyle(frame.scale)
  const previewFrameStyle = getPreviewFrameStyle(frame.scale)
  const previewCompromised = session.compromised

  return (
    <div
      className={cn(
        'overflow-hidden bg-white shadow-[0_8px_28px_var(--ark-stage-shadow)]',
        presentOpen
          ? 'fixed left-1/2 top-1/2 z-[60] -translate-x-1/2 -translate-y-1/2'
          : 'relative max-h-full max-w-full',
      )}
      ref={frame.stageRef}
      style={previewStageStyle}
    >
      {previewCompromised || !frame.model.iframeSrc ? null : (
        <iframe
          className="absolute left-0 top-0 block border-0 bg-white"
          key={frame.model.iframeKey}
          onLoad={() => {
            const decision = session.onFrameLoad()
            if (!decision.allowDownstream) {
              return
            }

            navigation.goToSlide(navigation.activeSlideIndexRef.current)
            if (editor.active) {
              editor.enableEditor(
                navigation.activeSlideIndexRef.current,
                editor.activeTool,
                frame.scale || undefined,
              )
            }
          }}
          ref={frame.iframeRef}
          referrerPolicy="no-referrer"
          sandbox={getPreviewSandbox(runtime.mode)}
          src={frame.model.iframeSrc}
          style={previewFrameStyle}
          title="Generated Ark presentation preview"
          {...PREVIEW_IFRAME_SECURITY_PROPS}
        />
      )}
      {children}
      <DeckPreviewStatusOverlays
        compromised={previewCompromised}
        compromiseReason={session.compromiseReason}
        editorError={editor.editorError}
        frameError={frame.model.error}
        isLoading={frame.model.isLoading}
        isPresentOpen={presentOpen}
        isPreviewUpdating={isPreviewUpdating}
        networkIssue={runtime.networkIssue}
        onDismissRuntimeError={runtime.onDismissRuntimeError}
        runtimeError={
          runtime.runtimeError?.deckId === deckId &&
          runtime.runtimeError.documentRevision === documentRevision
            ? runtime.runtimeError
            : null
        }
        usesStaticPreview={runtime.usesStaticPreview}
      />
    </div>
  )
}

export function DeckPreviewLoadingStage({ previewFrameScale }: { previewFrameScale: number }) {
  return (
    <div
      aria-label="Loading deck preview"
      className="relative max-h-full max-w-full overflow-hidden shadow-[0_8px_28px_var(--ark-stage-shadow)]"
      role="status"
      style={getPreviewStageStyle(previewFrameScale)}
    >
      <Skeleton className="absolute inset-0 rounded-none motion-reduce:animate-none" />
    </div>
  )
}
