import { Menu } from 'electron'

// Electron installs a default File/Edit/View/Window menu whenever an app never sets
// one. Ark's chrome lives in the renderer title bar, so that menu is dead weight.
//
// macOS keeps a two-item template rather than no menu at all: the system draws a menu
// bar for the frontmost app either way, and the standard roles are what bind Cmd+Q and
// the clipboard shortcuts. Dropping them there would leave copy/paste broken inside the
// composer, so only File/View/Window/Help go away on that platform.
export function configureApplicationMenu() {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]))
    return
  }
  Menu.setApplicationMenu(null)
}
