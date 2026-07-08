import { createHash } from 'node:crypto'

import type { DeckVersionProvenance, DeckProvenanceOperation } from '@ark/contracts'
import type { AgentStep } from '@ark/deck-core/chat.ts'
import type { DeckPatchOperation } from '@ark/deck-core/deck-patch.ts'
import type { DeckVersionDetail } from '@ark/contracts'
import type { DeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'

const PROVENANCE_OPERATION_SET = new Set<DeckProvenanceOperation>([
  'add_slide',
  'delete_slide',
  'replace_slide',
  'reorder_slide',
  'update_slide_title',
  'update_slide_notes',
  'replace_text',
  'insert_element',
  'delete_element',
  'duplicate_element',
  'set_attrs',
  'set_inline_style',
  'move_element',
  'resize_element',
  'reorder_element',
  'lock_element',
  'unlock_element',
  'text_replace',
  'undo',
  'redo',
])

const MAX_TOOL_CALLS = 50
const MAX_SUMMARY_LENGTH = 300

function truncateSummary(summary: string) {
  const withoutHtml = summary
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (withoutHtml.length <= MAX_SUMMARY_LENGTH) {
    return withoutHtml
  }

  return `${withoutHtml.slice(0, MAX_SUMMARY_LENGTH - 1)}…`
}

function toProvenanceOperation(op: string): DeckProvenanceOperation | null {
  return PROVENANCE_OPERATION_SET.has(op as DeckProvenanceOperation)
    ? (op as DeckProvenanceOperation)
    : null
}

export function hashRuntimeManifest(manifest: DeckRuntimeManifest) {
  const sorted = Object.fromEntries(
    Object.keys(manifest)
      .sort()
      .map((key) => [key, manifest[key as keyof DeckRuntimeManifest]]),
  )

  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}

export function buildManualVersionProvenance(
  operations: DeckPatchOperation[],
  patchResult: {
    changedSlideIndexes: number[]
    changedElementIds: string[]
  },
): DeckVersionProvenance {
  const provenanceOperations = operations
    .map((operation) => toProvenanceOperation(operation.op))
    .filter((operation): operation is DeckProvenanceOperation => operation !== null)

  return {
    operations: provenanceOperations.length > 0 ? provenanceOperations : undefined,
    slideIndexes:
      patchResult.changedSlideIndexes.length > 0 ? patchResult.changedSlideIndexes : undefined,
    elementIds:
      patchResult.changedElementIds.length > 0 ? patchResult.changedElementIds : undefined,
  }
}

export function buildAgentVersionProvenance(input: {
  jobId: string
  steps: AgentStep[]
}): DeckVersionProvenance {
  const toolCalls = input.steps
    .filter((step) => step.type === 'tool-call' || step.type === 'tool-result')
    .map((step) => ({
      toolName: (step.toolName ?? 'unknown').slice(0, 64),
      summary: truncateSummary(step.summary),
      ...(step.error ? { error: true } : {}),
    }))
    .slice(0, MAX_TOOL_CALLS)

  return {
    jobId: input.jobId.slice(0, 64),
    stepCount: input.steps.length,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  }
}

export function buildRollbackVersionProvenance(
  targetVersion: Pick<DeckVersionDetail, 'id' | 'versionNumber'>,
): DeckVersionProvenance {
  return {
    restoredVersionId: targetVersion.id,
    restoredVersionNumber: targetVersion.versionNumber,
  }
}

export function compactVersionProvenanceForAgent(
  provenance: DeckVersionProvenance | null | undefined,
) {
  if (!provenance) {
    return null
  }

  return {
    operations: provenance.operations,
    slideIndexes: provenance.slideIndexes,
    elementIds: provenance.elementIds?.length,
    jobId: provenance.jobId,
    stepCount: provenance.stepCount,
    toolCalls: provenance.toolCalls,
    restoredVersionId: provenance.restoredVersionId,
    restoredVersionNumber: provenance.restoredVersionNumber,
    runtimeManifestHash: provenance.runtimeManifestHash,
  }
}
