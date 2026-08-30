/** Row shapes and handles for an open `.ark` workspace file. */

import type { DatabaseSync } from 'node:sqlite'

import type { DeckOrigin } from '@ark/deck/document/origin.ts'

export type RecentWorkspace = {
  id: string
  path: string
  title: string
  updatedAt: string
  lastOpened: string
  cover?: string
}

export type WorkspaceRow = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  documentRevision: number
  origin: DeckOrigin
  html: string
  path: string
}

export class WorkspaceDocumentConflictError extends Error {
  readonly code = 'document_conflict'
  readonly currentDocumentRevision: number

  constructor(currentDocumentRevision: number) {
    super('The deck changed. Re-read it and retry against the latest revision.')
    this.name = 'WorkspaceDocumentConflictError'
    this.currentDocumentRevision = currentDocumentRevision
  }
}

export type WorkspaceMetadata = Omit<WorkspaceRow, 'html'>

/**
 * What can be read from a closed file without migrating it: `inspectWorkspaceFile`
 * opens read-only, so it must not touch columns an older file may still lack.
 */
export type WorkspaceIdentity = Omit<WorkspaceMetadata, 'origin'>

export type OpenWorkspace = {
  id: string
  path: string
  database: DatabaseSync
}
