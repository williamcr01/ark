import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EditorSelectionOverlay } from './EditorSelectionOverlay'

const geometry = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }

describe('EditorSelectionOverlay', () => {
  it('uses adaptive selection chrome with a light-surface default', () => {
    const { container, rerender } = render(<EditorSelectionOverlay geometry={geometry} scale={1} />)

    expect(container.firstElementChild).toHaveClass('border-black', 'shadow-[0_0_0_1px_#fff]')

    rerender(<EditorSelectionOverlay geometry={geometry} scale={1} surface="dark" />)

    expect(container.firstElementChild).toHaveClass('border-white', 'shadow-[0_0_0_1px_#000]')
  })
})
