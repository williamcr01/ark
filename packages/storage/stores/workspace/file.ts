/** Reading a workspace file: its rows, its metadata, and its identity without migrating it. */

import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { isValidDeckId } from '@ark/deck/document/id.ts'
import { normalizeDeckOrigin } from '@ark/deck/document/origin.ts'
import { normalizeDeckTitle } from '@ark/deck/document/title.ts'

import { resolveArkDataDir } from '../../fs/data-dir.ts'
import { ARK_APPLICATION_ID, ARK_WORKSPACE_FORMAT_VERSION } from './schema.ts'
import type { OpenWorkspace, WorkspaceIdentity, WorkspaceMetadata, WorkspaceRow } from './types.ts'

export const defaultWorkspaceDir = () =>
  process.env.ARK_WORKSPACES_DIR?.trim() || resolveArkDataDir('workspaces')
export const recentWorkspacesPath = () =>
  process.env.ARK_RECENT_WORKSPACES_PATH?.trim() || resolveArkDataDir('recent-workspaces.json')

export function readWorkspace(open: OpenWorkspace): WorkspaceRow {
  const row = open.database
    .prepare(
      `SELECT w.id, w.title, w.created_at, w.updated_at, w.document_revision, w.origin, d.html
       FROM workspace w JOIN document d ON d.id = 1`,
    )
    .get() as
    | {
        id: string
        title: string
        created_at: string
        updated_at: string
        document_revision: number
        origin: string
        html: string
      }
    | undefined

  if (!row) throw new Error('Invalid Ark workspace: workspace document is missing.')
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    documentRevision: row.document_revision,
    origin: normalizeDeckOrigin(row.origin),
    html: row.html,
    path: open.path,
  }
}

export function readWorkspaceMetadata(open: OpenWorkspace): WorkspaceMetadata {
  const row = open.database
    .prepare('SELECT id, title, created_at, updated_at, document_revision, origin FROM workspace')
    .get() as
    | {
        id: string
        title: string
        created_at: string
        updated_at: string
        document_revision: number
        origin: string
      }
    | undefined

  if (!row) throw new Error('Invalid Ark workspace: metadata is missing.')
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    documentRevision: row.document_revision,
    origin: normalizeDeckOrigin(row.origin),
    path: open.path,
  }
}

export function inspectWorkspaceFile(filePath: string): WorkspaceIdentity {
  const resolved = path.resolve(filePath)
  let database: DatabaseSync
  try {
    database = new DatabaseSync(resolved, { readOnly: true })
  } catch (error) {
    throw new Error('Could not open Ark workspace.', { cause: error })
  }

  try {
    const applicationId = database.prepare('PRAGMA application_id').get() as {
      application_id: number
    }
    const userVersion = database.prepare('PRAGMA user_version').get() as {
      user_version: number
    }
    const row = database
      .prepare(
        `SELECT id, title, created_at, updated_at, document_revision, format_version
         FROM workspace`,
      )
      .get() as
      | {
          id: string
          title: string
          created_at: string
          updated_at: string
          document_revision: number
          format_version: number
        }
      | undefined

    if (
      applicationId.application_id !== ARK_APPLICATION_ID ||
      userVersion.user_version !== ARK_WORKSPACE_FORMAT_VERSION ||
      row?.format_version !== ARK_WORKSPACE_FORMAT_VERSION ||
      !row ||
      !isValidDeckId(row.id)
    ) {
      throw new Error('Unsupported or invalid Ark workspace.')
    }

    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      documentRevision: row.document_revision,
      path: resolved,
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Unsupported or invalid Ark workspace.') {
      throw error
    }
    throw new Error('Unsupported or invalid Ark workspace.', { cause: error })
  } finally {
    database.close()
  }
}

export function safeFileStem(title: string) {
  return (
    normalizeDeckTitle(title)
      // Intentionally strips control characters from filesystem names.
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/[. ]+$/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 120) || 'Untitled Presentation'
  )
}
