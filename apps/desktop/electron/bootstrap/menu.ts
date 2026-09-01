import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

export type EditHistoryMenuState = {
  canUndo: boolean
  canRedo: boolean
}

export type EditHistoryAction = 'undo' | 'redo'

let undoItem: Electron.MenuItem | null = null
let redoItem: Electron.MenuItem | null = null
/**
 * The renderer whose stack the menu items currently reflect. Undo/Redo enabled
 * state is global, so the click must go back to the window that reported it —
 * dispatching to the focused window would silently no-op whenever another
 * window (Present mode) has focus.
 */
let editHistoryOwner: Electron.WebContents | null = null

export function sendEditHistoryAction(action: EditHistoryAction) {
  if (editHistoryOwner && !editHistoryOwner.isDestroyed()) {
    editHistoryOwner.send('edit:history-action', action)
    return
  }

  const win = BrowserWindow.getFocusedWindow()
  if (win && !win.isDestroyed()) win.webContents.send('edit:history-action', action)
}

export function setEditHistoryMenuState(
  state: EditHistoryMenuState,
  sender: Electron.WebContents | null = null,
) {
  editHistoryOwner = sender
  if (undoItem) undoItem.enabled = state.canUndo
  if (redoItem) redoItem.enabled = state.canRedo
}

/**
 * macOS Edit menu: Undo/Redo stay enabled with the session stack.
 *
 * `registerAccelerator: false` so Cmd+Z still reaches the renderer — iframe
 * text undo and Shift-constrained resize must not be stolen by the menu.
 */
export function buildDarwinEditMenuTemplate(): MenuItemConstructorOptions {
  return {
    label: 'Edit',
    submenu: [
      {
        id: 'edit-undo',
        label: 'Undo',
        accelerator: 'CmdOrCtrl+Z',
        registerAccelerator: false,
        enabled: false,
        click: () => sendEditHistoryAction('undo'),
      },
      {
        id: 'edit-redo',
        label: 'Redo',
        accelerator: 'Shift+CmdOrCtrl+Z',
        registerAccelerator: false,
        enabled: false,
        click: () => sendEditHistoryAction('redo'),
      },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  }
}

export function configureApplicationMenu() {
  if (process.platform !== 'darwin') {
    undoItem = null
    redoItem = null
    editHistoryOwner = null
    Menu.setApplicationMenu(null)
    return
  }

  const menu = Menu.buildFromTemplate([{ role: 'appMenu' }, buildDarwinEditMenuTemplate()])
  undoItem = menu.getMenuItemById('edit-undo')
  redoItem = menu.getMenuItemById('edit-redo')
  Menu.setApplicationMenu(menu)
}
