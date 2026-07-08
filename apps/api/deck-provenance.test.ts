import { describe, expect, it } from 'vitest'

import type { AgentStep } from '@ark/deck-core/chat.ts'

import {
  buildAgentVersionProvenance,
  buildManualVersionProvenance,
  buildRollbackVersionProvenance,
  compactVersionProvenanceForAgent,
  hashRuntimeManifest,
} from './deck-provenance.ts'

describe('deck provenance builders', () => {
  it('builds manual provenance from patch operations and result', () => {
    const provenance = buildManualVersionProvenance(
      [{ op: 'replace_text', elementId: 'ark-el-1', text: 'Hi' }],
      {
        changedSlideIndexes: [0],
        changedElementIds: ['ark-el-1'],
      },
    )

    expect(provenance).toEqual({
      operations: ['replace_text'],
      slideIndexes: [0],
      elementIds: ['ark-el-1'],
    })
  })

  it('projects agent tool steps without text steps or HTML', () => {
    const htmlSnippet = '<section class="slide"><h1>Secret deck HTML</h1></section>'
    const steps: AgentStep[] = [
      { type: 'text', summary: `Assistant said ${htmlSnippet}` },
      { type: 'tool-call', toolName: 'patch_deck', summary: 'rename slide 0' },
      {
        type: 'tool-result',
        toolName: 'patch_deck',
        summary: `Applied patch with ${htmlSnippet}`,
        error: false,
      },
    ]

    const provenance = buildAgentVersionProvenance({
      jobId: 'a0000000-0000-4000-8000-000000000001',
      steps,
    })

    expect(provenance.stepCount).toBe(3)
    expect(provenance.jobId).toBe('a0000000-0000-4000-8000-000000000001')
    expect(provenance.toolCalls).toEqual([
      { toolName: 'patch_deck', summary: 'rename slide 0' },
      {
        toolName: 'patch_deck',
        summary: 'Applied patch with Secret deck HTML',
      },
    ])
    expect(JSON.stringify(provenance)).not.toContain('<section')
    expect(JSON.stringify(provenance)).not.toContain('<!doctype')
  })

  it('truncates long tool summaries', () => {
    const longSummary = 'x'.repeat(400)
    const provenance = buildAgentVersionProvenance({
      jobId: 'job-1',
      steps: [{ type: 'tool-call', toolName: 'read_deck', summary: longSummary }],
    })

    expect(provenance.toolCalls?.[0]?.summary.length).toBeLessThanOrEqual(300)
  })

  it('builds rollback provenance from the restored version', () => {
    expect(
      buildRollbackVersionProvenance({
        id: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
        versionNumber: 4,
      }),
    ).toEqual({
      restoredVersionId: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
      restoredVersionNumber: 4,
    })
  })

  it('hashes runtime manifests with sorted keys', () => {
    const manifest = {
      slideCount: 2,
      runtimeMode: 'static',
      previewMode: 'css-only',
      schemaVersion: 1,
    }

    expect(hashRuntimeManifest(manifest)).toMatch(/^[a-f0-9]{64}$/)
    expect(hashRuntimeManifest({ ...manifest })).toBe(hashRuntimeManifest(manifest))
  })

  it('strips HTML from tool-call summaries when compacting for the agent', () => {
    const htmlSnippet = '<section class="slide"><h1>Secret deck HTML</h1></section>'
    const compact = compactVersionProvenanceForAgent({
      jobId: 'job-1',
      stepCount: 1,
      toolCalls: [{ toolName: 'patch_deck', summary: `Applied ${htmlSnippet}` }],
    })

    expect(compact?.toolCalls).toEqual([
      { toolName: 'patch_deck', summary: 'Applied Secret deck HTML' },
    ])
    expect(JSON.stringify(compact)).not.toContain('<section')
  })
})
