export type WorkspaceMode = 'create' | 'loading' | 'editor'

export function resolveWorkspaceMode(
  origin: string | null | undefined,
  routeDeckId: string | null,
  isDeckLoading: boolean,
): WorkspaceMode {
  if (origin === 'blank' || !routeDeckId) {
    return 'create'
  }

  if (isDeckLoading && origin == null) {
    return 'loading'
  }

  return 'editor'
}

export function routeDeckIdFromParam(routeParam: string | undefined): string | null {
  return routeParam && routeParam !== 'new' ? routeParam : null
}
