import { create } from 'zustand'

import type { ManualEditProvenance } from '@ark/deck/document/edit-provenance.ts'
import type { EditorSelectionInfo, EditorTool } from '@ark/editor-runtime'
import { MAX_SLIDE_CONTEXTS } from '@ark/contracts'
import {
  resolveContextSlides,
  toggleContextSlideEntry,
  type ContextSlideEntry,
  type SlideHtmlEntry,
} from '@/lib/deck/slide-context'

import { resolveUpdate, type StateUpdate } from './apply-update.ts'

export type ExternalEditProvenance = {
  source: 'external'
  clientName: string | null
  toolName: string
  summary: string
  createdAt: string
}

export type AgentEditProvenance = {
  source: 'agent'
  summary: string
  createdAt: string
}

export type DeckEditHistoryEntry = {
  beforeHtml: string
  afterHtml: string
  slideIndex: number
  provenance: ManualEditProvenance | ExternalEditProvenance | AgentEditProvenance
}

export type HistoryState = {
  stack: DeckEditHistoryEntry[]
  pointer: number
}

export const EMPTY_HISTORY_STATE: HistoryState = { stack: [], pointer: -1 }

export const EXTERNAL_COALESCE_IDLE_MS = 2_000

function isExternalProvenance(
  provenance: DeckEditHistoryEntry['provenance'],
): provenance is ExternalEditProvenance {
  return provenance.source === 'external'
}

function canCoalesceExternalWrites(
  previous: DeckEditHistoryEntry,
  next: DeckEditHistoryEntry,
): boolean {
  if (!isExternalProvenance(previous.provenance) || !isExternalProvenance(next.provenance)) {
    return false
  }

  if (previous.provenance.clientName !== next.provenance.clientName) {
    return false
  }

  const previousAt = Date.parse(previous.provenance.createdAt)
  const nextAt = Date.parse(next.provenance.createdAt)
  if (!Number.isFinite(previousAt) || !Number.isFinite(nextAt)) {
    return false
  }

  return nextAt - previousAt <= EXTERNAL_COALESCE_IDLE_MS
}

export function recordDeckEdit(state: HistoryState, entry: DeckEditHistoryEntry): HistoryState {
  if (entry.beforeHtml === entry.afterHtml) {
    return state
  }

  const retained = state.stack.slice(0, state.pointer + 1)
  const previous = retained.at(-1)
  const atLiveTip = state.pointer === state.stack.length - 1
  if (atLiveTip && previous && canCoalesceExternalWrites(previous, entry)) {
    const merged: DeckEditHistoryEntry = {
      ...previous,
      afterHtml: entry.afterHtml,
      slideIndex: entry.slideIndex,
      provenance: entry.provenance,
    }
    const stack = [...retained.slice(0, -1), merged]
    return { stack, pointer: stack.length - 1 }
  }

  const stack = [...retained, entry]
  return { stack, pointer: stack.length - 1 }
}

function sameSelection(
  current: EditorSelectionInfo | null,
  next: EditorSelectionInfo | null,
): boolean {
  if (current === next) {
    return true
  }

  if (!current || !next) {
    return false
  }

  return (
    current.elementId === next.elementId &&
    current.slideIndex === next.slideIndex &&
    current.slideId === next.slideId &&
    current.tagName === next.tagName &&
    current.locked === next.locked &&
    current.managed === next.managed &&
    current.editableKind === next.editableKind &&
    current.textPreview === next.textPreview &&
    current.surface === next.surface &&
    current.geometryEditable === next.geometryEditable &&
    current.role === next.role &&
    current.imageFit === next.imageFit
  )
}

export type EditorStoreState = {
  editorSelection: EditorSelectionInfo | null
  editorSelections: EditorSelectionInfo[]
  contextSlides: ContextSlideEntry[]
  history: HistoryState
  isStripOpen: boolean
  selectedTool: EditorTool
}

export type EditorStoreActions = {
  clearSelection: () => void
  commitRedo: () => void
  commitUndo: () => void
  recordEdit: (entry: DeckEditHistoryEntry) => void
  reset: () => void
  resetHistory: () => void
  select: (selection: EditorSelectionInfo | null, selections?: EditorSelectionInfo[]) => void
  setContextSlides: (update: StateUpdate<ContextSlideEntry[]>) => void
  setSelectedTool: (selectedTool: EditorTool) => void
  setStripOpen: (update: StateUpdate<boolean>) => void
  syncContextSlides: (slides: SlideHtmlEntry[]) => void
  toggleContextSlide: (
    slideIndex: number,
    slides: SlideHtmlEntry[],
    max?: number,
  ) => { capped: boolean }
}

export type EditorStore = EditorStoreState & EditorStoreActions

const initialState: EditorStoreState = {
  editorSelection: null,
  editorSelections: [],
  contextSlides: [],
  history: EMPTY_HISTORY_STATE,
  isStripOpen: true,
  selectedTool: 'select',
}

export const useEditorStore = create<EditorStore>()((set, get) => ({
  ...initialState,
  clearSelection: () => {
    set({ editorSelection: null, editorSelections: [] })
  },
  commitRedo: () => {
    set((state) =>
      state.history.pointer < state.history.stack.length - 1
        ? { history: { ...state.history, pointer: state.history.pointer + 1 } }
        : state,
    )
  },
  commitUndo: () => {
    set((state) =>
      state.history.pointer >= 0
        ? { history: { ...state.history, pointer: state.history.pointer - 1 } }
        : state,
    )
  },
  recordEdit: (entry) => {
    set((state) => ({ history: recordDeckEdit(state.history, entry) }))
  },
  reset: () => {
    set(initialState)
  },
  resetHistory: () => {
    set({ history: EMPTY_HISTORY_STATE })
  },
  select: (selection, selections = []) => {
    set((state) => ({
      editorSelection: sameSelection(state.editorSelection, selection)
        ? state.editorSelection
        : selection,
      editorSelections: selections,
    }))
  },
  setContextSlides: (update) => {
    set((state) => ({ contextSlides: resolveUpdate(state.contextSlides, update) }))
  },
  setSelectedTool: (selectedTool) => {
    set({ selectedTool })
  },
  setStripOpen: (update) => {
    set((state) => ({ isStripOpen: resolveUpdate(state.isStripOpen, update) }))
  },
  syncContextSlides: (slides) => {
    set((state) => ({ contextSlides: resolveContextSlides(state.contextSlides, slides) }))
  },
  toggleContextSlide: (slideIndex, slides, max = MAX_SLIDE_CONTEXTS) => {
    const result = toggleContextSlideEntry(get().contextSlides, slideIndex, slides, max)
    if (!result.capped) {
      set({ contextSlides: result.entries })
    }
    return { capped: result.capped }
  },
}))

export const selectCanUndo = (state: EditorStoreState) => state.history.pointer >= 0

export const selectCanRedo = (state: EditorStoreState) =>
  state.history.pointer < state.history.stack.length - 1

export const selectUndoEntry = (state: EditorStoreState): DeckEditHistoryEntry | null =>
  selectCanUndo(state) ? (state.history.stack[state.history.pointer] ?? null) : null

export const selectRedoEntry = (state: EditorStoreState): DeckEditHistoryEntry | null =>
  selectCanRedo(state) ? (state.history.stack[state.history.pointer + 1] ?? null) : null

export const useEditorSelection = () => useEditorStore((state) => state.editorSelection)
export const useIsStripOpen = () => useEditorStore((state) => state.isStripOpen)
