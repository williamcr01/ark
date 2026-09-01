import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { EditModeToolbar } from './EditModeToolbar'

vi.mock('@/lib/api/deck-api', () => ({
  listDocumentHistory: vi.fn().mockResolvedValue([]),
}))

const DEFAULT_STATE: NonNullable<ComponentProps<typeof EditModeToolbar>['state']> = {
  canEditText: false,
  canRedo: false,
  canUndo: false,
  hasDeck: true,
  hasSelection: false,
  isGenerating: false,
  isSaving: false,
  selectedImage: false,
  selectionLocked: false,
  selectionManaged: false,
  textEditActive: false,
}

function renderToolbar(overrides: Partial<ComponentProps<typeof EditModeToolbar>> = {}) {
  const onToolChange = vi.fn()

  render(
    <TooltipProvider>
      <EditModeToolbar
        activeTool="select"
        state={{
          canEditText: false,
          canRedo: false,
          canUndo: false,
          hasDeck: true,
          hasSelection: false,
          isGenerating: false,
          isSaving: false,
          selectedImage: false,
          selectionLocked: false,
          selectionManaged: false,
          textEditActive: false,
        }}
        onToolChange={onToolChange}
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
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('data-state', 'on')
    expect(screen.getByRole('button', { name: 'Text box' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'Insert image' })).not.toHaveAttribute('aria-pressed')
  })

  it('opens the image picker from a plain button', async () => {
    const user = userEvent.setup()
    const onPickImage = vi.fn()
    renderToolbar({ onPickImage })

    await user.click(screen.getByRole('button', { name: 'Insert image' }))

    expect(onPickImage).toHaveBeenCalledTimes(1)
  })

  it('disables tools when no deck is loaded', () => {
    renderToolbar({ state: { ...DEFAULT_STATE, hasDeck: false } })

    expect(screen.getByText('No deck loaded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Text box' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Insert image' })).toBeDisabled()
  })

  it('shows generation paused state and disables tools while generating', () => {
    renderToolbar({ state: { ...DEFAULT_STATE, isGenerating: true } })

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
    renderToolbar({ state: { ...DEFAULT_STATE, canEditText: true } })

    expect(screen.getByRole('button', { name: 'Edit selected text' })).toBeEnabled()
  })

  it('shows locked status for locked selections', () => {
    renderToolbar({ state: { ...DEFAULT_STATE, hasSelection: true, selectionLocked: true } })

    expect(screen.getByText('Locked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete selected element (locked)' })).toBeDisabled()
  })

  it('enables unlocked selection actions when available', () => {
    const onDuplicate = vi.fn()
    renderToolbar({
      state: { ...DEFAULT_STATE, hasSelection: true, selectionManaged: true },
      onDuplicate,
    })

    expect(screen.getByRole('button', { name: 'Duplicate selected element' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Bring forward' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Send backward' })).toBeEnabled()
  })

  it('disables history actions when there is nothing to undo or redo', () => {
    renderToolbar({ state: { ...DEFAULT_STATE, hasSelection: true } })

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Duplicate selected element' })).toBeEnabled()
  })

  it('enables and triggers undo and redo when available', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn()
    const onRedo = vi.fn()

    renderToolbar({ state: { ...DEFAULT_STATE, canUndo: true, canRedo: true }, onUndo, onRedo })

    const undoButton = screen.getByRole('button', { name: 'Undo' })
    const redoButton = screen.getByRole('button', { name: 'Redo' })

    expect(undoButton).toBeEnabled()
    expect(redoButton).toBeEnabled()

    await user.click(undoButton)
    await user.click(redoButton)

    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onRedo).toHaveBeenCalledTimes(1)
    expect(undoButton).toHaveAttribute('aria-keyshortcuts', 'Control+Z Meta+Z')
    expect(redoButton).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Shift+Z Meta+Shift+Z Control+Y',
    )
  })

  it('opens restore versions next to undo and redo', async () => {
    const user = userEvent.setup()
    const onRestoreHistory = vi.fn().mockResolvedValue(undefined)

    renderToolbar({
      deckId: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
      onRestoreHistory,
    })

    expect(screen.getByRole('button', { name: 'Restore version' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Restore version' }))
    expect(
      await screen.findByText('Restore version', { selector: '[data-slot="dropdown-menu-label"]' }),
    ).toBeInTheDocument()
  })

  it('disables history actions while saving or editing text', () => {
    renderToolbar({
      deckId: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
      onRestoreHistory: vi.fn().mockResolvedValue(undefined),
      state: { ...DEFAULT_STATE, canUndo: true, canRedo: true, isSaving: true },
    })

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Restore version' })).toBeDisabled()
  })
})
