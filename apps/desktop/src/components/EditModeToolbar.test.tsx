import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { EditModeToolbar } from './EditModeToolbar'

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
    expect(screen.getByRole('button', { name: 'Insert image' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('disables tools when no deck is loaded', () => {
    renderToolbar({ hasDeck: false })

    expect(screen.getByText('No deck loaded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Text box' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Insert image' })).toBeDisabled()
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

  it('enables unlocked selection actions when available', () => {
    const onDuplicate = vi.fn()
    renderToolbar({ hasSelection: true, onDuplicate, selectionManaged: true })

    expect(screen.getByRole('button', { name: 'Duplicate selected element' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Bring forward' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Send backward' })).toBeEnabled()
  })

  it('disables history actions when there is nothing to undo or redo', () => {
    renderToolbar({ hasSelection: true })

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Duplicate selected element' })).toBeEnabled()
  })

  it('enables and triggers undo and redo when available', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn()
    const onRedo = vi.fn()

    renderToolbar({ canUndo: true, canRedo: true, onUndo, onRedo })

    const undoButton = screen.getByRole('button', { name: 'Undo' })
    const redoButton = screen.getByRole('button', { name: 'Redo' })

    expect(undoButton).toBeEnabled()
    expect(redoButton).toBeEnabled()

    await user.click(undoButton)
    await user.click(redoButton)

    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onRedo).toHaveBeenCalledTimes(1)
  })

  it('disables history actions while saving or editing text', () => {
    renderToolbar({ canUndo: true, canRedo: true, isSaving: true })

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
  })
})
