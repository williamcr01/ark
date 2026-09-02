import { type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MAX_SLIDE_CONTEXTS } from '@ark/contracts'
import { useEditorStore } from '@/state/editor-store.ts'

import { useChatContextSlides } from './useChatContextSlides'
import { WorkspaceRuntimeContext, type WorkspaceRuntimeValue } from './workspace-runtime-context'

vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

vi.mock('./useDeckAnalysis', () => ({
  useDeckAnalysis: () => ({
    slides: Array.from({ length: MAX_SLIDE_CONTEXTS + 2 }, (_, index) => ({
      index,
      outerHTML: `<section>Slide ${index + 1}</section>`,
    })),
  }),
}))

function wrapper({ children }: { children: ReactNode }) {
  return (
    <WorkspaceRuntimeContext.Provider value={{} as WorkspaceRuntimeValue}>
      {children}
    </WorkspaceRuntimeContext.Provider>
  )
}

describe('useChatContextSlides', () => {
  it('toggles slides and warns when the cap is hit', () => {
    const { result } = renderHook(() => useChatContextSlides(), { wrapper })

    act(() => {
      for (let index = 0; index < MAX_SLIDE_CONTEXTS; index += 1) {
        result.current.handleToggleContextSlide(index)
      }
    })
    expect(result.current.contextSlideIndexes).toHaveLength(MAX_SLIDE_CONTEXTS)

    act(() => {
      result.current.handleToggleContextSlide(MAX_SLIDE_CONTEXTS)
    })
    expect(result.current.contextSlideIndexes).toHaveLength(MAX_SLIDE_CONTEXTS)
    expect(useEditorStore.getState().contextSlides).toHaveLength(MAX_SLIDE_CONTEXTS)
  })

  it('removes and clears attached slides', () => {
    const { result } = renderHook(() => useChatContextSlides(), { wrapper })
    act(() => {
      result.current.handleToggleContextSlide(0)
      result.current.handleToggleContextSlide(1)
    })
    act(() => {
      result.current.handleRemoveContextSlide(0)
    })
    expect(result.current.contextSlideIndexes).toEqual([1])
    act(() => {
      result.current.handleClearContextSlides()
    })
    expect(result.current.contextSlideIndexes).toEqual([])
  })
})
