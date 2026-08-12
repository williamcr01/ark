import { createRef } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EditorSelectionOverlay, type EditorSelectionOverlayHandle } from './EditorSelectionOverlay'

const geometry = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }

describe('EditorSelectionOverlay', () => {
  it('uses adaptive selection chrome with a light-surface default', () => {
    const { container, rerender } = render(<EditorSelectionOverlay geometry={geometry} scale={1} />)

    expect(container.firstElementChild).toHaveClass('border-black', 'shadow-[0_0_0_1px_#fff]')

    rerender(<EditorSelectionOverlay geometry={geometry} scale={1} surface="dark" />)

    expect(container.firstElementChild).toHaveClass('border-white', 'shadow-[0_0_0_1px_#000]')
  })

  it('restores committed geometry when a live preview is cancelled', () => {
    const ref = createRef<EditorSelectionOverlayHandle>()
    const { container } = render(<EditorSelectionOverlay geometry={geometry} ref={ref} scale={1} />)
    const box = container.querySelector('[aria-hidden]') as HTMLElement
    const initialStyle = {
      left: box.style.left,
      top: box.style.top,
      width: box.style.width,
      height: box.style.height,
    }

    ref.current?.applyTransformPreview({ x: 0.5, y: 0.6, width: 0.2, height: 0.2 })
    expect(box.style.left).not.toBe(initialStyle.left)

    ref.current?.clearTransformPreview()

    expect(box.style.left).toBe(initialStyle.left)
    expect(box.style.top).toBe(initialStyle.top)
    expect(box.style.width).toBe(initialStyle.width)
    expect(box.style.height).toBe(initialStyle.height)
  })

  it('reapplies the active preview after the overlay scale changes', () => {
    const ref = createRef<EditorSelectionOverlayHandle>()
    const preview = { x: 0.5, y: 0.6, width: 0.2, height: 0.2 }
    const { container, rerender } = render(
      <EditorSelectionOverlay geometry={geometry} ref={ref} scale={1} />,
    )
    const box = container.querySelector('[aria-hidden]') as HTMLElement

    ref.current?.applyTransformPreview(preview)
    rerender(<EditorSelectionOverlay geometry={geometry} ref={ref} scale={2} />)

    expect(box.style.left).toBe('1280px')
    expect(box.style.top).toBe('864px')
    expect(box.style.width).toBe('512px')
    expect(box.style.height).toBe('288px')
  })
})
