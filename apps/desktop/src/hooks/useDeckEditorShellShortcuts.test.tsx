import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useDeckEditorShellShortcuts } from './useDeckEditorShellShortcuts'

const options = () => ({
  active: true,
  textEditActive: false,
  isTextEditSaving: false,
  activeTool: 'select',
  canEditSelectedText: true,
  canUndo: true,
  canRedo: true,
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onEndTextEditing: vi.fn(),
  onSelectTool: vi.fn(),
  onBeginTextEdit: vi.fn(),
  onInsertImage: vi.fn(),
})

describe('useDeckEditorShellShortcuts', () => {
  it('binds shortcuts only while active and cleans them up on unmount', () => {
    const callbacks = options()
    const view = renderHook(() => useDeckEditorShellShortcuts(callbacks))

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(callbacks.onBeginTextEdit).toHaveBeenCalledOnce()

    view.unmount()
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(callbacks.onBeginTextEdit).toHaveBeenCalledOnce()
  })

  it('preserves native undo while text editing', () => {
    const callbacks = { ...options(), textEditActive: true }
    renderHook(() => useDeckEditorShellShortcuts(callbacks))
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true })

    act(() => window.dispatchEvent(event))

    expect(event.defaultPrevented).toBe(false)
    expect(callbacks.onUndo).not.toHaveBeenCalled()
  })
})
