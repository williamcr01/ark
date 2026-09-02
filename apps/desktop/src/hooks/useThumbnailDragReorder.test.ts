import { act, renderHook } from '@testing-library/react'
import { type DragEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ParsedDeck } from '@/lib/deck/deck-slides'

import { useThumbnailDragReorder } from './useThumbnailDragReorder'

function createParsedDeck(slideCount: number): ParsedDeck {
  return {
    bodyAttrs: '',
    getThumbnailSrcDoc: (index) => `slide-${index}`,
    headHtml: '',
    htmlAttrs: '',
    slideCount,
    thumbnailSharedKey: 'shared',
    slides: Array.from({ length: slideCount }, (_, index) => ({
      index,
      outerHTML: `<section>Slide ${index + 1}</section>`,
    })),
  }
}

function createDataTransfer() {
  const data = new Map<string, string>()
  return {
    dropEffect: 'none',
    effectAllowed: 'none',
    getData: vi.fn((type: string) => data.get(type) ?? ''),
    setData: vi.fn((type: string, value: string) => data.set(type, value)),
  } as unknown as DataTransfer
}

function attachThumbnails(
  getDragProps: ReturnType<typeof useThumbnailDragReorder>['getDragProps'],
  count: number,
) {
  return Array.from({ length: count }, (_, index) => {
    const node = document.createElement('div')
    const top = index * 108
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
      bottom: top + 100,
      height: 100,
      left: 0,
      right: 152,
      toJSON: () => ({}),
      top,
      width: 152,
      x: 0,
      y: top,
    } as DOMRect)
    getDragProps(index).ref(node)
    return node
  })
}

function dragEvent(
  node: HTMLElement,
  dataTransfer: DataTransfer,
  clientY: number,
): DragEvent<HTMLDivElement> {
  return {
    clientX: 0,
    clientY,
    currentTarget: node,
    dataTransfer,
    preventDefault: vi.fn(),
  } as unknown as DragEvent<HTMLDivElement>
}

describe('useThumbnailDragReorder', () => {
  it('commits a drop onto a later thumbnail and clears after a deck identity change', async () => {
    const onReorder = vi.fn().mockResolvedValue(undefined)
    const activeItemRef = { current: null }
    const firstDeck = createParsedDeck(3)
    const { result } = renderHook(
      ({ parsedDeck }) =>
        useThumbnailDragReorder({
          activeIndex: 0,
          activeItemRef,
          onReorder,
          orientation: 'vertical',
          parsedDeck,
          slideCount: 3,
        }),
      { initialProps: { parsedDeck: firstDeck } },
    )

    const nodes = attachThumbnails(result.current.getDragProps, 3)
    const dataTransfer = createDataTransfer()

    act(() => {
      result.current.getDragProps(0).onDragStart(dragEvent(nodes[0], dataTransfer, 0))
    })

    expect(result.current.draggedIndex).toBe(0)
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', '0')

    act(() => {
      result.current.dropZoneProps.onDragOver(dragEvent(nodes[2], dataTransfer, 300))
    })
    expect(result.current.insertionIndex).toBe(3)

    act(() => {
      result.current.dropZoneProps.onDrop(dragEvent(nodes[2], dataTransfer, 300))
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(onReorder).toHaveBeenCalledWith(0, 2)
  })

  it('does not emit a same-index reorder', () => {
    const onReorder = vi.fn()
    const activeItemRef = { current: null }
    const { result } = renderHook(() =>
      useThumbnailDragReorder({
        activeIndex: 0,
        activeItemRef,
        onReorder,
        orientation: 'vertical',
        parsedDeck: createParsedDeck(2),
        slideCount: 2,
      }),
    )

    const nodes = attachThumbnails(result.current.getDragProps, 2)
    const dataTransfer = createDataTransfer()

    act(() => {
      result.current.getDragProps(0).onDragStart(dragEvent(nodes[0], dataTransfer, 0))
    })
    act(() => {
      result.current.dropZoneProps.onDrop(dragEvent(nodes[0], dataTransfer, 60))
    })

    expect(onReorder).not.toHaveBeenCalled()
    expect(result.current.draggedIndex).toBeNull()
  })

  it('drops the in-flight preview when a new deck object renders', () => {
    const onReorder = vi.fn().mockResolvedValue(undefined)
    const activeItemRef = { current: null }
    const { rerender, result } = renderHook(
      ({ parsedDeck }) =>
        useThumbnailDragReorder({
          activeIndex: 0,
          activeItemRef,
          onReorder,
          orientation: 'vertical',
          parsedDeck,
          slideCount: 3,
        }),
      { initialProps: { parsedDeck: createParsedDeck(3) } },
    )

    const nodes = attachThumbnails(result.current.getDragProps, 3)
    const dataTransfer = createDataTransfer()

    act(() => {
      result.current.getDragProps(0).onDragStart(dragEvent(nodes[0], dataTransfer, 0))
    })
    expect(result.current.draggedIndex).toBe(0)

    rerender({ parsedDeck: createParsedDeck(3) })
    expect(result.current.draggedIndex).toBeNull()
    expect(result.current.insertionIndex).toBeNull()
  })
})
