import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { EditModeToolbar, PreviewEditModeToggle } from './EditModeToolbar'

function renderToolbar(overrides: Partial<ComponentProps<typeof EditModeToolbar>> = {}) {
  const onToolChange = vi.fn()

  render(
    <TooltipProvider>
      <EditModeToolbar
        activeTool="select"
        canEditText={false}
        hasDeck
        hasSelection={false}
        isGenerating={false}
        isSaving={false}
        onToolChange={onToolChange}
        selectionLocked={false}
        selectionManaged={false}
        textEditActive={false}
        {...overrides}
      />
    </TooltipProvider>,
  )

  return { onToolChange }
}

describe('EditModeToolbar', () => {
  it('exposes accessible labels for primary tools', () => {
    renderToolbar()

    expect(screen.getByRole('toolbar', { name: 'Edit mode toolbar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Text box' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'Image' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('disables tools when no deck is loaded', () => {
    renderToolbar({ hasDeck: false })

    expect(screen.getByText('No deck loaded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Text box' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Image' })).toBeDisabled()
  })

  it('shows generation paused state and disables tools while generating', () => {
    renderToolbar({ isGenerating: true })

    expect(screen.getByText('Editing paused during generation')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled()
  })

  it('switches tools through the callback', async () => {
    const user = userEvent.setup()
    const { onToolChange } = renderToolbar()

    await user.click(screen.getByRole('button', { name: 'Text box' }))

    expect(onToolChange).toHaveBeenCalledWith('text')
  })

  it('shows edit-text action for editable selections', () => {
    renderToolbar({ canEditText: true })

    expect(screen.getByRole('button', { name: 'Edit selected text' })).toBeEnabled()
  })

  it('shows locked status for locked selections', () => {
    renderToolbar({ hasSelection: true, selectionLocked: true })

    expect(screen.getByText('Locked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete selected element (locked)' })).toBeDisabled()
  })

  it('enables managed selection actions when available', () => {
    const onDuplicate = vi.fn()
    renderToolbar({ hasSelection: true, selectionManaged: true, onDuplicate })

    expect(screen.getByRole('button', { name: 'Duplicate selected element' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Bring forward' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Send backward' })).toBeEnabled()
  })

  it('marks history actions as disabled', () => {
    renderToolbar({ hasSelection: true })

    expect(screen.getByRole('button', { name: 'Undo (coming soon)' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo (coming soon)' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Duplicate selected element (not managed)' }),
    ).toBeDisabled()
  })
})

describe('PreviewEditModeToggle', () => {
  it('exposes pressed state for preview and edit modes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<PreviewEditModeToggle active={false} disabled={false} onChange={onChange} />)

    expect(screen.getByRole('button', { name: 'Preview mode' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Edit mode' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    await user.click(screen.getByRole('button', { name: 'Edit mode' }))

    expect(onChange).toHaveBeenCalledWith(true)
  })
})
