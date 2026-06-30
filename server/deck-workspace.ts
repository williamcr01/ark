export type DeckWorkspace = {
  html: string
  changed: boolean
}

export function createDeckWorkspace(initialHtml = ''): DeckWorkspace {
  return {
    html: initialHtml,
    changed: false,
  }
}

export function setDeckWorkspaceHtml(workspace: DeckWorkspace, html: string) {
  workspace.html = html
  workspace.changed = true
}
