import type {
  EditorDeleteRequestMessage,
  EditorHoverMessage,
  EditorInsertRequestMessage,
  EditorNormalizedRect,
  EditorSelectionInfo,
  EditorShortcutMessage,
  EditorTransformCommitMessage,
  EditorTransformPreviewMessage,
} from '@ark/editor-runtime'

export type DeckEditorBridgeState = {
  editorReady: boolean
  selection: EditorSelectionInfo | null
  /** Full same-slide selection set; empty when nothing is selected. */
  selections: EditorSelectionInfo[]
  hover: Pick<EditorHoverMessage, 'elementId' | 'slideIndex' | 'surface'> | null
  geometry: EditorNormalizedRect | null
  /** Viewport-normalized slide box for composing overlay geometry. */
  slideBounds: EditorNormalizedRect | null
  /** Per-element overlay geometry for the full selection set (issue #248). */
  selectionGeometries: Record<
    string,
    {
      geometry: EditorNormalizedRect
      slideBounds: EditorNormalizedRect | null
    }
  >
  selectionZIndex: number | null
  editorError: string | null
  /** First preview frame as a gesture-in-progress marker; latest geometry is delivered through the ref/listener. */
  transformPreview: EditorTransformPreviewMessage | null
  transformCommit: EditorTransformCommitMessage | null
  transformCancelSequence: number
  lastInsertRequest: EditorInsertRequestMessage | null
  lastDeleteRequest: EditorDeleteRequestMessage | null
  lastShortcutRequest: (EditorShortcutMessage & { sequence: number }) | null
  textEditActive: boolean
  hoverGeometry: EditorNormalizedRect | null
  hoverSlideBounds: EditorNormalizedRect | null
  lastTextCommit: {
    elementId: string
    slideIndex: number
    slideId: string | null
    text: string
    originalText: string
  } | null
}

export const INITIAL_EDITOR_BRIDGE_STATE: DeckEditorBridgeState = {
  editorReady: false,
  selection: null,
  selections: [],
  hover: null,
  geometry: null,
  slideBounds: null,
  selectionGeometries: {},
  selectionZIndex: null,
  editorError: null,
  transformPreview: null,
  transformCommit: null,
  transformCancelSequence: 0,
  lastInsertRequest: null,
  lastDeleteRequest: null,
  lastShortcutRequest: null,
  textEditActive: false,
  hoverGeometry: null,
  hoverSlideBounds: null,
  lastTextCommit: null,
}

export type SelectionIdentity = { elementId: string; slideIndex: number } | null
