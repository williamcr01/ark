/**
 * An Ark workspace is one `.ark` SQLite file per deck. This is the public surface;
 * the pieces live in ./workspace.
 */

export { WorkspaceStore, createWorkspaceStore } from './workspace/store.ts'
export { ARK_APPLICATION_ID, ARK_WORKSPACE_FORMAT_VERSION } from './workspace/schema.ts'
export { WorkspaceDocumentConflictError } from './workspace/types.ts'
export type { WorkspaceRow } from './workspace/types.ts'
