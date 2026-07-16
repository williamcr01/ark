import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import type { EditorSelectionInfo } from '@ark/deck-core/deck-editor-bridge.ts'

import { ElementInspector } from './ElementInspector'

function makeSelection(overrides: Partial<EditorSelectionInfo> = {}): EditorSelectionInfo {
  return {
    elementId: 'ark-el-1',
    slideIndex: 0,
    slideId: 'ark-slide-1',
    tagName: 'div',
    locked: false,
    managed: true,
    editableKind: 'text-box',
    textPreview: 'Hello world',
    imageFit: null,
    role: 'user-inserted',
    textStyle: {
      fontSize: 24,
      fontWeight: '400',
      color: 'rgb(15, 23, 42)',
      textAlign: 'left',
      lineHeight: 32,
    },
    imageNaturalSize: null,
    ...overrides,
  }
}

const geometry = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }

function renderInspector(overrides: Partial<ComponentProps<typeof ElementInspector>> = {}) {
  const onApplyOperations = vi.fn()

  render(
    <TooltipProvider>
      <ElementInspector
        geometry={geometry}
        isSaving={false}
        onApplyOperations={onApplyOperations}
        selection={makeSelection()}
        textEditActive={false}
        zIndex={3}
        {...overrides}
      />
    </TooltipProvider>,
  )

  return { onApplyOperations }
}

describe('ElementInspector', () => {
  it('renders nothing when nothing is selected in the floating variant', () => {
    const { container } = render(
      <TooltipProvider>
        <ElementInspector
          geometry={null}
          isSaving={false}
          selection={null}
          textEditActive={false}
          zIndex={null}
        />
      </TooltipProvider>,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('shows an empty state in the sidebar variant when nothing is selected', () => {
    renderInspector({ selection: null, variant: 'sidebar' })

    expect(screen.getByRole('complementary', { name: 'Element inspector' })).toBeInTheDocument()
    expect(screen.getByText(/select an element on the slide/i)).toBeInTheDocument()
  })

  it('renders identity, geometry, layer, text, and state sections for a text box', () => {
    renderInspector()

    expect(screen.getByText('Text box')).toBeInTheDocument()
    expect(screen.getByText('<div>')).toBeInTheDocument()
    expect(screen.getByText('user-inserted')).toBeInTheDocument()

    expect(screen.getByRole('textbox', { name: 'X (%)' })).toHaveValue('10.0')
    expect(screen.getByRole('textbox', { name: 'Y (%)' })).toHaveValue('20.0')
    expect(screen.getByRole('textbox', { name: 'W (%)' })).toHaveValue('30.0')
    expect(screen.getByRole('textbox', { name: 'H (%)' })).toHaveValue('10.0')

    expect(screen.getByRole('button', { name: 'Bring forward' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Send backward' })).toBeEnabled()

    expect(screen.getByRole('textbox', { name: 'Aa (px)' })).toHaveValue('24')
    expect(screen.getByRole('combobox', { name: 'Font weight' })).toHaveValue('400')
    expect(screen.getByRole('button', { name: 'Align left' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    expect(screen.getByRole('button', { name: 'Lock element' })).toBeEnabled()

    // No image section for text boxes.
    expect(screen.queryByRole('combobox', { name: 'Image fit mode' })).not.toBeInTheDocument()
  })

  it('renders image controls and hides text controls for images', () => {
    renderInspector({
      selection: makeSelection({
        editableKind: 'image',
        tagName: 'img',
        textStyle: null,
        textPreview: 'A chart',
        imageFit: 'cover',
        imageNaturalSize: { width: 800, height: 400 },
      }),
    })

    expect(screen.getByRole('heading', { name: 'Image' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Alt text' })).toHaveValue('A chart')
    expect(screen.getByRole('combobox', { name: 'Image fit mode' })).toHaveValue('cover')
    expect(screen.getByText('800 × 400 px')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset to image aspect ratio' })).toBeEnabled()

    expect(screen.queryByRole('combobox', { name: 'Font weight' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Aa (px)' })).not.toBeInTheDocument()
  })

  it('does not crash for generic or unknown selections', () => {
    renderInspector({
      selection: makeSelection({
        editableKind: 'mystery-kind',
        tagName: 'canvas',
        textStyle: null,
      }),
      geometry: null,
      zIndex: null,
    })

    expect(screen.getByText('Element')).toBeInTheDocument()
    expect(screen.getByText(/geometry unavailable/i)).toBeInTheDocument()
  })

  it('explains locked elements and disables mutating controls', () => {
    renderInspector({ selection: makeSelection({ locked: true }) })

    expect(screen.getByRole('note')).toHaveTextContent(/locked/i)
    expect(screen.getByRole('textbox', { name: 'X (%)' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bring forward' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Font weight' })).toBeDisabled()
    // Unlock stays available so the lock can be removed.
    expect(screen.getByRole('button', { name: 'Unlock element' })).toBeEnabled()
  })

  it('keeps geometry disabled until an unlocked unmanaged element is adopted', () => {
    renderInspector({
      selection: makeSelection({ managed: false, editableKind: null, tagName: 'h1' }),
    })

    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'X (%)' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Font weight' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Send backward' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Lock element' })).toBeEnabled()
  })

  it('disables controls while saving', () => {
    renderInspector({ isSaving: true })

    expect(screen.getByRole('textbox', { name: 'X (%)' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bring forward' })).toBeDisabled()
  })

  it('commits geometry edits on Enter as move operations', async () => {
    const user = userEvent.setup()
    const { onApplyOperations } = renderInspector()

    const xInput = screen.getByRole('textbox', { name: 'X (%)' })
    await user.clear(xInput)
    await user.type(xInput, '50{enter}')

    expect(onApplyOperations).toHaveBeenCalledTimes(1)
    expect(onApplyOperations).toHaveBeenCalledWith(
      [
        {
          op: 'move_element',
          elementId: 'ark-el-1',
          slideIndex: 0,
          slideId: 'ark-slide-1',
          x: 0.5,
          y: 0.2,
        },
      ],
      'Moved element',
    )
  })

  it('commits size edits on blur as resize operations', async () => {
    const user = userEvent.setup()
    const { onApplyOperations } = renderInspector()

    const widthInput = screen.getByRole('textbox', { name: 'W (%)' })
    await user.clear(widthInput)
    await user.type(widthInput, '60')
    await user.tab()

    expect(onApplyOperations).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          op: 'resize_element',
          width: 0.6,
          height: 0.1,
        }),
      ],
      'Resized element',
    )
  })

  it('does not commit unchanged or invalid geometry input', async () => {
    const user = userEvent.setup()
    const { onApplyOperations } = renderInspector()

    const xInput = screen.getByRole('textbox', { name: 'X (%)' })
    await user.clear(xInput)
    await user.type(xInput, '10.0{enter}')

    await user.clear(xInput)
    await user.type(xInput, 'abc{enter}')

    expect(onApplyOperations).not.toHaveBeenCalled()
  })

  it('commits font size, weight, alignment, and line height styles', async () => {
    const user = userEvent.setup()
    const { onApplyOperations } = renderInspector()

    const sizeInput = screen.getByRole('textbox', { name: 'Aa (px)' })
    await user.clear(sizeInput)
    await user.type(sizeInput, '32{enter}')

    expect(onApplyOperations).toHaveBeenCalledWith(
      [expect.objectContaining({ op: 'set_inline_style', style: { 'font-size': '32px' } })],
      'Updated font size',
    )

    await user.selectOptions(screen.getByRole('combobox', { name: 'Font weight' }), '700')

    expect(onApplyOperations).toHaveBeenCalledWith(
      [expect.objectContaining({ op: 'set_inline_style', style: { 'font-weight': '700' } })],
      'Updated font weight',
    )

    await user.click(screen.getByRole('button', { name: 'Align center' }))

    expect(onApplyOperations).toHaveBeenCalledWith(
      [expect.objectContaining({ op: 'set_inline_style', style: { 'text-align': 'center' } })],
      'Updated text alignment',
    )

    const lineHeightInput = screen.getByRole('textbox', { name: 'Lh (px)' })
    await user.clear(lineHeightInput)
    await user.type(lineHeightInput, '40{enter}')

    expect(onApplyOperations).toHaveBeenCalledWith(
      [expect.objectContaining({ op: 'set_inline_style', style: { 'line-height': '40px' } })],
      'Updated line height',
    )
  })

  it('commits image alt text and fit changes', async () => {
    const user = userEvent.setup()
    const { onApplyOperations } = renderInspector({
      selection: makeSelection({
        editableKind: 'image',
        tagName: 'img',
        textStyle: null,
        textPreview: '',
        imageFit: 'contain',
        imageNaturalSize: { width: 800, height: 400 },
      }),
    })

    const altInput = screen.getByRole('textbox', { name: 'Alt text' })
    await user.type(altInput, 'Revenue chart{enter}')

    expect(onApplyOperations).toHaveBeenCalledWith(
      [expect.objectContaining({ op: 'set_attrs', attrs: { alt: 'Revenue chart' } })],
      'Updated image alt text',
    )

    await user.selectOptions(screen.getByRole('combobox', { name: 'Image fit mode' }), 'cover')

    expect(onApplyOperations).toHaveBeenCalledWith(
      [
        expect.objectContaining({ op: 'set_inline_style', style: { 'object-fit': 'cover' } }),
        expect.objectContaining({ op: 'set_attrs', attrs: { 'data-ark-fit': 'cover' } }),
      ],
      'Updated image fit mode',
    )
  })

  it('resets the image to its intrinsic aspect ratio', async () => {
    const user = userEvent.setup()
    const { onApplyOperations } = renderInspector({
      selection: makeSelection({
        editableKind: 'image',
        tagName: 'img',
        textStyle: null,
        imageNaturalSize: { width: 800, height: 400 },
      }),
    })

    await user.click(screen.getByRole('button', { name: 'Reset to image aspect ratio' }))

    expect(onApplyOperations).toHaveBeenCalledTimes(1)
    const [operations, summary] = onApplyOperations.mock.calls[0] as [
      Array<{ op: string; width: number; height: number }>,
      string,
    ]

    expect(summary).toBe('Reset image to intrinsic aspect ratio')
    expect(operations[0].op).toBe('resize_element')
    expect(operations[0].width).toBeCloseTo(0.3, 5)
    expect(operations[0].height).toBeCloseTo(192 / 720, 5)
  })

  it('commits layer reorder operations', async () => {
    const user = userEvent.setup()
    const { onApplyOperations } = renderInspector()

    await user.click(screen.getByRole('button', { name: 'Bring forward' }))

    expect(onApplyOperations).toHaveBeenCalledWith(
      [expect.objectContaining({ op: 'reorder_element', direction: 'front' })],
      'Brought element forward',
    )

    await user.click(screen.getByRole('button', { name: 'Send backward' }))

    expect(onApplyOperations).toHaveBeenCalledWith(
      [expect.objectContaining({ op: 'reorder_element', direction: 'back' })],
      'Sent element backward',
    )
  })

  it('commits lock and unlock operations', async () => {
    const user = userEvent.setup()
    const { onApplyOperations } = renderInspector()

    await user.click(screen.getByRole('button', { name: 'Lock element' }))

    expect(onApplyOperations).toHaveBeenCalledWith(
      [expect.objectContaining({ op: 'lock_element' })],
      'Locked element',
    )

    const second = renderInspector({ selection: makeSelection({ locked: true }) })

    await user.click(screen.getByRole('button', { name: 'Unlock element' }))

    expect(second.onApplyOperations).toHaveBeenCalledWith(
      [expect.objectContaining({ op: 'unlock_element' })],
      'Unlocked element',
    )
  })

  describe('debounced color commits', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('debounces text color changes before committing once', () => {
      const { onApplyOperations } = renderInspector()

      // user-event pointer APIs are unreliable for color inputs; drive the
      // change events directly.
      const colorInput = screen.getByLabelText('Text color')
      fireEvent.change(colorInput, { target: { value: '#ff0000' } })
      fireEvent.change(colorInput, { target: { value: '#00ff00' } })

      expect(onApplyOperations).not.toHaveBeenCalled()

      vi.advanceTimersByTime(500)

      expect(onApplyOperations).toHaveBeenCalledTimes(1)
      expect(onApplyOperations).toHaveBeenCalledWith(
        [expect.objectContaining({ op: 'set_inline_style', style: { color: '#00ff00' } })],
        'Updated text color',
      )
    })
  })
})
