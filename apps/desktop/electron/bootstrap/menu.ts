import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

export type EditHistoryMenuState = {
  canUndo: boolean
  canRedo: boolean
}

export type EditHistoryAction = 'undo' | 'redo'

let undoItem: Electron.MenuItem | null = null
let redoItem: Electron.MenuItem | null = null

export function sendEditHistoryAction(action: EditHistoryAction) {
  const win = BrowserWindow.getFocusedWindow()
  if (win && !win.isDestroyed()) win.webContents.send('edit:history-action', action)
}

export function setEditHistoryMenuState(state: EditHistoryMenuState) {
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
    Menu.setApplicationMenu(null)
    return
  }

  const menu = Menu.buildFromTemplate([{ role: 'appMenu' }, buildDarwinEditMenuTemplate()])
  undoItem = menu.getMenuItemById('edit-undo')
  redoItem = menu.getMenuItemById('edit-redo')
  Menu.setApplicationMenu(menu)
}
