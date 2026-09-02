import type { UseEditorRuntimePatchesOptions } from './useEditorCommitPatches.ts'
import { useEditorCommitPatches } from './useEditorCommitPatches.ts'
import { useEditorShortcutPatches } from './useEditorShortcutPatches.ts'

export type { UseEditorRuntimePatchesOptions }

export function useEditorRuntimePatches(options: UseEditorRuntimePatchesOptions) {
  useEditorCommitPatches(options)
  useEditorShortcutPatches(options)
}
