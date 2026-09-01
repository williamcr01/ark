/**
 * Electron main-process code: no DOM.
 *
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const getMenuItemById = vi.fn()
const setApplicationMenu = vi.fn()
const buildFromTemplate = vi.fn(() => ({ getMenuItemById }))
const getFocusedWindow = vi.fn()
const send = vi.fn()

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow },
  Menu: { buildFromTemplate, setApplicationMenu },
}))

const {
  buildDarwinEditMenuTemplate,
  configureApplicationMenu,
  sendEditHistoryAction,
  setEditHistoryMenuState,
} = await import('./menu.ts')

describe('application edit menu', () => {
  const originalPlatform = process.platform

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    vi.clearAllMocks()
  })

  it('installs a custom Undo/Redo edit menu on macOS without stealing accelerators', () => {
    const undo = { enabled: false }
    const redo = { enabled: false }
    getMenuItemById.mockImplementation((id: string) => (id === 'edit-undo' ? undo : redo))
    Object.defineProperty(process, 'platform', { value: 'darwin' })

    configureApplicationMenu()

    expect(buildFromTemplate).toHaveBeenCalledOnce()
    expect(buildFromTemplate).toHaveBeenCalledWith([
      { role: 'appMenu' },
      expect.objectContaining({ label: 'Edit' }),
    ])
    const edit = buildDarwinEditMenuTemplate()
    const items = Array.isArray(edit.submenu) ? edit.submenu : []
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'edit-undo',
          accelerator: 'CmdOrCtrl+Z',
          registerAccelerator: false,
          enabled: false,
        }),
        expect.objectContaining({
          id: 'edit-redo',
          accelerator: 'Shift+CmdOrCtrl+Z',
          registerAccelerator: false,
          enabled: false,
        }),
      ]),
    )
  })

  it('keeps no application menu on Windows and Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    configureApplicationMenu()
    expect(setApplicationMenu).toHaveBeenCalledWith(null)
  })

  it('syncs Undo/Redo enabled state with the session stack', () => {
    const undo = { enabled: false }
    const redo = { enabled: false }
    getMenuItemById.mockImplementation((id: string) => (id === 'edit-undo' ? undo : redo))
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    configureApplicationMenu()

    setEditHistoryMenuState({ canUndo: true, canRedo: false })
    expect(undo.enabled).toBe(true)
    expect(redo.enabled).toBe(false)

    setEditHistoryMenuState({ canUndo: false, canRedo: true })
    expect(undo.enabled).toBe(false)
    expect(redo.enabled).toBe(true)
  })

  it('forwards menu Undo/Redo clicks to the focused window when no renderer reported state', () => {
    setEditHistoryMenuState({ canUndo: true, canRedo: true })
    getFocusedWindow.mockReturnValue({ isDestroyed: () => false, webContents: { send } })
    sendEditHistoryAction('undo')
    expect(send).toHaveBeenCalledWith('edit:history-action', 'undo')
    sendEditHistoryAction('redo')
    expect(send).toHaveBeenCalledWith('edit:history-action', 'redo')
  })

  it('forwards menu Undo/Redo clicks to the renderer that reported the state', () => {
    // Enabled state is global, so a click must reach the window whose stack the
    // menu reflects — not whichever window (Present mode) happens to be focused.
    const ownerSend = vi.fn()
    getFocusedWindow.mockReturnValue({ isDestroyed: () => false, webContents: { send } })
    setEditHistoryMenuState({ canUndo: true, canRedo: true }, {
      isDestroyed: () => false,
      send: ownerSend,
    } as unknown as Electron.WebContents)

    sendEditHistoryAction('undo')

    expect(ownerSend).toHaveBeenCalledWith('edit:history-action', 'undo')
    expect(send).not.toHaveBeenCalled()
  })

  it('falls back to the focused window when the reporting renderer is gone', () => {
    const ownerSend = vi.fn()
    getFocusedWindow.mockReturnValue({ isDestroyed: () => false, webContents: { send } })
    setEditHistoryMenuState({ canUndo: true, canRedo: true }, {
      isDestroyed: () => true,
      send: ownerSend,
    } as unknown as Electron.WebContents)

    sendEditHistoryAction('redo')

    expect(ownerSend).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('edit:history-action', 'redo')
  })
})
