import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { EditorSelectionInfo } from '@ark/editor-runtime'

import { ChatContextChips, ContextChipList } from './ChatContextChips'
import { contextToChipProps } from '@/lib/chat/chat-context-chips'

const selection: EditorSelectionInfo = {
  elementId: 'ark-el-1',
  slideIndex: 1,
  slideId: null,
  tagName: 'p',
  locked: false,
  managed: true,
  editableKind: 'text-box',
  textPreview: 'Q2 revenue grew 18%',
  surface: 'light',
  geometryEditable: true,
}

describe('ChatContextChips', () => {
  it('renders nothing when there is no context', () => {
    const { container } = render(
      <ChatContextChips
        editorSelection={null}
        onClearEditorSelection={vi.fn()}
        onRemoveSlide={vi.fn()}
        slides={[]}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders element and slide chips and handles dismiss', async () => {
    const user = userEvent.setup()
    const onClearEditorSelection = vi.fn()
    const onRemoveSlide = vi.fn()

    render(
      <ChatContextChips
        editorSelection={selection}
        onClearEditorSelection={onClearEditorSelection}
        onRemoveSlide={onRemoveSlide}
        slides={[
          { slideIndex: 0, title: 'Title' },
          { slideIndex: 2, title: 'Market' },
        ]}
      />,
    )

    expect(screen.getByLabelText('Chat context')).toBeInTheDocument()
    expect(screen.getByText(/Slide 2 · text-box/)).toBeInTheDocument()
    expect(screen.getByText('Slide 1 — Title')).toBeInTheDocument()
    expect(screen.getByText('Slide 3 — Market')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Remove selected element from chat context' }),
    )
    expect(onClearEditorSelection).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Remove slide 3 from chat context' }))
    expect(onRemoveSlide).toHaveBeenCalledWith(2)
  })

  it('renders read-only chips from persisted context', () => {
    const chips = contextToChipProps({
      editorSelection: {
        slideIndex: 0,
        elementId: 'ark-el-2',
        elementKind: 'image',
        textPreview: 'Logo',
      },
      slideContexts: [{ slideIndex: 1, title: 'Agenda' }],
    })

    render(<ContextChipList className="mt-2" label="Attached context" {...chips} />)

    expect(screen.getByLabelText('Attached context')).toBeInTheDocument()
    expect(screen.getByText(/Slide 1 · image/)).toBeInTheDocument()
    expect(screen.getByText('Slide 2 — Agenda')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove selected element from chat context' }),
    ).toBeNull()
  })
})
