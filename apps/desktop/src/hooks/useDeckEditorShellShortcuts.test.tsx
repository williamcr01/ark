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

  it('undoes with Cmd/Ctrl+Z and redoes with Shift+Cmd/Ctrl+Z or Ctrl+Y', () => {
    const callbacks = options()
    renderHook(() => useDeckEditorShellShortcuts(callbacks))

    act(() =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true }),
      ),
    )
    expect(callbacks.onUndo).toHaveBeenCalledOnce()

    act(() =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, cancelable: true }),
      ),
    )
    expect(callbacks.onRedo).toHaveBeenCalledOnce()

    act(() =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, cancelable: true }),
      ),
    )
    expect(callbacks.onRedo).toHaveBeenCalledTimes(2)
  })

  it('does not treat Shift without Cmd/Ctrl as undo or redo', () => {
    const callbacks = options()
    renderHook(() => useDeckEditorShellShortcuts(callbacks))
    const event = new KeyboardEvent('keydown', { key: 'z', shiftKey: true, cancelable: true })

    act(() => window.dispatchEvent(event))

    expect(event.defaultPrevented).toBe(false)
    expect(callbacks.onUndo).not.toHaveBeenCalled()
    expect(callbacks.onRedo).not.toHaveBeenCalled()
  })

  it('keeps native menu items in sync with the session stack', () => {
    const setHistoryState = vi.fn()
    window.arkDesktop.edit = {
      setHistoryState,
      onHistoryAction: vi.fn().mockReturnValue(() => undefined),
    }
    renderHook(() => useDeckEditorShellShortcuts(options()))

    expect(setHistoryState).toHaveBeenCalledWith({ canUndo: true, canRedo: true })
  })

  it('runs Undo/Redo from the application menu through the same guards', () => {
    const callbacks = options()
    let listener: ((action: 'undo' | 'redo') => void) | undefined
    window.arkDesktop.edit = {
      setHistoryState: vi.fn(),
      onHistoryAction: vi.fn((next) => {
        listener = next
        return () => undefined
      }),
    }
    renderHook(() => useDeckEditorShellShortcuts(callbacks))

    act(() => listener?.('undo'))
    act(() => listener?.('redo'))

    expect(callbacks.onUndo).toHaveBeenCalledOnce()
    expect(callbacks.onRedo).toHaveBeenCalledOnce()
  })

  it('ignores application-menu undo while text editing', () => {
    const callbacks = { ...options(), textEditActive: true }
    let listener: ((action: 'undo' | 'redo') => void) | undefined
    window.arkDesktop.edit = {
      setHistoryState: vi.fn(),
      onHistoryAction: vi.fn((next) => {
        listener = next
        return () => undefined
      }),
    }
    renderHook(() => useDeckEditorShellShortcuts(callbacks))

    act(() => listener?.('undo'))

    expect(callbacks.onUndo).not.toHaveBeenCalled()
    expect(window.arkDesktop.edit?.setHistoryState).toHaveBeenCalledWith({
      canUndo: false,
      canRedo: false,
    })
  })
})
