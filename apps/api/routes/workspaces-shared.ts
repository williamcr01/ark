import type { ApiErrorPayload, StoredDeck } from '@ark/contracts'
import type { WorkspaceRow } from '@ark/storage/stores/workspace-store.ts'
import { getApiErrorFromUnknown } from './shared.ts'

export const toDeck = (workspace: WorkspaceRow): StoredDeck => ({
  id: workspace.id,
  html: workspace.html,
  title: workspace.title,
  createdAt: workspace.createdAt,
  updatedAt: workspace.updatedAt,
  documentRevision: workspace.documentRevision,
  origin: workspace.origin,
  filePath: workspace.path,
})

/**
 * Map workspace action failures to an HTTP status and a structured payload.
 * The two conflict cases carry machine-readable codes so the renderer can
 * offer overwrite / pick-a-different-name without parsing prose.
 */
export const workspaceActionError = (
  error: unknown,
): { status: number; payload: ApiErrorPayload } => {
  const message = error instanceof Error ? error.message : ''

  if (/already exists/i.test(message)) {
    return { status: 409, payload: { error: message, code: 'workspace_file_exists' } }
  }

  if (/already open|same identity/i.test(message)) {
    return { status: 409, payload: { error: message, code: 'workspace_already_open' } }
  }

  if (/invalid|unsupported|different identity|could not open/i.test(message)) {
    return { status: 400, payload: getApiErrorFromUnknown(error) }
  }

  return { status: 500, payload: getApiErrorFromUnknown(error) }
}
