export function toWorkspaceFileName(deckTitle: string) {
  return `${deckTitle.replace(/[<>:"/\\|?*]/g, ' ').trim() || 'Untitled Presentation'}.ark`
}
