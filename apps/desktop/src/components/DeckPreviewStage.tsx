import { type MutableRefObject, type ReactNode, type RefObject } from 'react'

import { DeckPreviewFrame, DeckPreviewLoadingStage } from '@/components/DeckPreviewFrame'
import { EmptyPreview } from '@/components/EmptyPreview'
import type { DeckPreviewFrameModel } from '@/hooks/useDeckPreviewFrame'
import type { PreviewBridgeSessionResult } from '@/hooks/usePreviewBridgeSession'
import type { RuntimeErrorNotice } from '@/lib/deck/runtime-error-reporting.ts'
import type { DeckRuntimeMode } from '@ark/runtime-registry/deck-runtime.ts'
import { clientPointToNormalizedSlidePoint } from '@/lib/editor/deck-image-insert'
import type { EditorSelectionInfo, EditorTool } from '@ark/editor-runtime'
import { useDeckStore } from '@/state/deck-store.ts'

type DeckPreviewStageProps = {
  chrome: {
    editActive: boolean
    editorBridgeActive: boolean
    presentOpen: boolean
  }
  editor: {
    activeTool: EditorTool
    editorError: string | null
    enableEditor: (slideIndex: number, tool: EditorTool, scale?: number) => boolean
    onClearSelection: () => void
    onInsertImageFile: (file: File, position?: { x: number; y: number }) => void
    overlay: ReactNode
    selection: EditorSelectionInfo | null
    textEditActive: boolean
  }
  frame: {
    iframeRef: RefObject<HTMLIFrameElement | null>
    model: DeckPreviewFrameModel
    scale: number
    stageRef: RefObject<HTMLDivElement | null>
    viewportRef: RefObject<HTMLDivElement | null>
  }
  navigation: {
    activeSlideIndexRef: MutableRefObject<number>
    goToSlide: (index: number) => void
  }
  runtime: {
    mode: DeckRuntimeMode
    networkIssue?: string
    onDismissRuntimeError: () => void
    runtimeError: RuntimeErrorNotice | null
    usesStaticPreview: boolean
  }
  session: PreviewBridgeSessionResult
}

export function DeckPreviewStage({
  chrome,
  editor,
  frame,
  navigation,
  runtime,
  session,
}: DeckPreviewStageProps) {
  const html = useDeckStore((state) => state.html)
  const isDeckLoading = useDeckStore((state) => state.isLoading)

  return (
    <div
      className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden p-4 lg:p-6"
      onDragOver={(event) => {
        if (!chrome.editActive || editor.textEditActive) return
        if ([...event.dataTransfer.types].includes('Files')) event.preventDefault()
      }}
      onDrop={(event) => {
        if (!chrome.editActive || editor.textEditActive) return
        const file = event.dataTransfer.files[0]
        if (!file?.type.startsWith('image/')) return
        event.preventDefault()
        void editor.onInsertImageFile(
          file,
          clientPointToNormalizedSlidePoint(event.clientX, event.clientY, frame.stageRef.current),
        )
      }}
      onPointerDown={(event) => {
        if (!chrome.editActive || editor.textEditActive || !editor.selection) {
          return
        }
        if (event.target === event.currentTarget || event.target === frame.stageRef.current) {
          editor.onClearSelection()
        }
      }}
      ref={frame.viewportRef}
    >
      {isDeckLoading ? (
        <DeckPreviewLoadingStage previewFrameScale={frame.scale} />
      ) : html ? (
        <DeckPreviewFrame
          editor={{
            active: chrome.editorBridgeActive,
            activeTool: editor.activeTool,
            editorError: editor.editorError,
            enableEditor: editor.enableEditor,
          }}
          frame={{
            iframeRef: frame.iframeRef,
            model: frame.model,
            scale: frame.scale,
            stageRef: frame.stageRef,
          }}
          navigation={navigation}
          presentOpen={chrome.presentOpen}
          runtime={runtime}
          session={session}
        >
          {editor.overlay}
        </DeckPreviewFrame>
      ) : (
        <EmptyPreview />
      )}
    </div>
  )
}
