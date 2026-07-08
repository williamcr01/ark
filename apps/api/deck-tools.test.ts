import { describe, expect, it } from 'vitest'

import { createDeckTools } from './deck-tools.ts'
import { createDeckWorkspace } from './deck-workspace.ts'

const managedDeck = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Managed Deck</title>
  <style>section.slide { width: 100vw; height: 100vh; }</style>
</head>
<body>
  <section class="slide" data-ark-slide-id="ark-slide-title">
    <h1 data-ark-id="ark-el-title" data-ark-editable="true" data-ark-role="title">Opening</h1>
    <p data-ark-id="ark-el-locked" data-ark-locked="true">Do not edit</p>
  </section>
</body>
</html>`

type ToolExecute = (input: unknown, options: unknown) => Promise<Record<string, unknown>>

function runPatchElement(html: string, operations: unknown[]) {
  const workspace = createDeckWorkspace(html)
  const tools = createDeckTools(workspace)
  const execute = tools.patch_element.execute as unknown as ToolExecute
  return { workspace, result: execute({ operations }, {}) }
}

describe('patch_element tool', () => {
  it('replaces text on a selected element by id', async () => {
    const { workspace, result } = runPatchElement(managedDeck, [
      {
        op: 'replace_text',
        slideId: 'ark-slide-title',
        elementId: 'ark-el-title',
        text: 'Sharper opening',
      },
    ])

    const output = await result
    expect(output.ok).toBe(true)
    expect(output.changedElementIds).toContain('ark-el-title')
    expect(workspace.html).toContain('Sharper opening')
    expect(workspace.changed).toBe(true)
  })

  it('returns an error for a stale (missing) element id', async () => {
    const { workspace, result } = runPatchElement(managedDeck, [
      {
        op: 'replace_text',
        slideId: 'ark-slide-title',
        elementId: 'ark-el-does-not-exist',
        text: 'nope',
      },
    ])

    const output = await result
    expect(output.ok).toBe(false)
    expect(typeof output.error).toBe('string')
    expect(workspace.changed).toBe(false)
  })

  it('refuses to edit a locked element', async () => {
    const { workspace, result } = runPatchElement(managedDeck, [
      {
        op: 'replace_text',
        slideId: 'ark-slide-title',
        elementId: 'ark-el-locked',
        text: 'forced edit',
      },
    ])

    const output = await result
    expect(output.ok).toBe(false)
    expect(workspace.html).toContain('Do not edit')
    expect(workspace.changed).toBe(false)
  })

  it('errors when no deck is loaded', async () => {
    const { result } = runPatchElement('', [
      { op: 'replace_text', elementId: 'ark-el-title', text: 'x' },
    ])

    const output = await result
    expect(output.ok).toBe(false)
  })
})

describe('list_versions tool', () => {
  it('returns compact version metadata without HTML', async () => {
    const workspace = createDeckWorkspace(managedDeck)
    const versions = [
      {
        id: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
        deckId: 'a0000000-0000-4000-8000-000000000002',
        versionNumber: 2,
        title: 'Managed Deck',
        source: 'agent' as const,
        summary: 'AI edit',
        validationStatus: 'valid' as const,
        runtimeManifest: null,
        modelProvider: 'openai',
        modelName: 'gpt-4.1-mini',
        provenance: {
          jobId: 'job-1',
          stepCount: 2,
          toolCalls: [{ toolName: 'patch_deck', summary: 'rename slide' }],
        },
        diff: { kind: 'structural' as const, slideCountBefore: 1, slideCountAfter: 1 },
        createdAt: '2026-01-01T00:00:00.000Z',
        isActive: true,
      },
    ]

    const tools = createDeckTools(workspace, {
      versionInspector: {
        listVersions: async () => versions,
      },
    })

    const execute = tools.list_versions.execute as unknown as ToolExecute
    const output = await execute({ limit: 5 }, {})

    expect(output.versions).toEqual([
      {
        versionNumber: 2,
        source: 'agent',
        summary: 'AI edit',
        createdAt: '2026-01-01T00:00:00.000Z',
        validationStatus: 'valid',
        modelName: 'gpt-4.1-mini',
        diff: { kind: 'structural', slideCountBefore: 1, slideCountAfter: 1 },
        provenance: {
          jobId: 'job-1',
          stepCount: 2,
          toolCalls: [{ toolName: 'patch_deck', summary: 'rename slide' }],
        },
      },
    ])
    expect(JSON.stringify(output)).not.toContain('<html')
  })
})
