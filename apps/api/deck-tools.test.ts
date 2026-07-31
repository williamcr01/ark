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

describe('read_deck tool', () => {
  it('returns continuation metadata for a large slide', async () => {
    const html = `<html><body><section class="slide">${'x'.repeat(80_000)}</section></body></html>`
    const tools = createDeckTools(createDeckWorkspace(html))
    const execute = tools.read_deck.execute as unknown as ToolExecute
    const output = await execute({ slideIndex: 0 }, {})
    expect(output).toMatchObject({
      mode: 'slide',
      index: 0,
      truncated: true,
      charOffset: 0,
      nextCharOffset: expect.any(Number),
      hint: expect.stringContaining('charOffset'),
    })
  })
})

describe('attachment tools', () => {
  it('lists attachments and pages through text without putting bytes in the prompt', async () => {
    const attachments = [
      {
        id: 'asset-1',
        filename: 'data.csv',
        mediaType: 'text/csv',
        byteSize: 11,
        url: '/api/decks/deck-1/assets/asset-1',
      },
    ]
    const tools = createDeckTools(createDeckWorkspace(managedDeck), {
      attachmentInspector: {
        attachments,
        read: async () => Buffer.from('name,value\none,1'),
      },
    })
    const list = await (tools.list_attachments.execute as unknown as ToolExecute)({}, {})
    const read = await (tools.read_attachment.execute as unknown as ToolExecute)(
      { id: 'asset-1', limit: 10 },
      {},
    )

    expect(list).toEqual({ attachmentCount: 1, attachments })
    expect(read).toMatchObject({
      id: 'asset-1',
      content: 'name,value',
      nextOffset: 10,
    })
  })

  it('returns an Ark URL instead of loading binary attachment bytes', async () => {
    const tools = createDeckTools(createDeckWorkspace(managedDeck), {
      attachmentInspector: {
        attachments: [
          {
            id: 'asset-2',
            filename: 'photo.png',
            mediaType: 'image/png',
            byteSize: 100,
            url: '/api/decks/deck-1/assets/asset-2',
          },
        ],
        read: async () => {
          throw new Error('binary data should not be loaded')
        },
      },
    })
    const output = await (tools.read_attachment.execute as unknown as ToolExecute)(
      { id: 'asset-2' },
      {},
    )

    expect(output).toMatchObject({ id: 'asset-2', binary: true })
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

    expect(output.versions).toMatchObject([
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

  it('compacts asset URLs and truncates summaries for the agent', async () => {
    const workspace = createDeckWorkspace(managedDeck)
    const hugeSummary = `Applied <section>${'x'.repeat(600)}</section>`
    const tools = createDeckTools(workspace, {
      versionInspector: {
        listVersions: async () => [
          {
            id: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
            deckId: 'a0000000-0000-4000-8000-000000000002',
            versionNumber: 3,
            title: 'Managed Deck',
            source: 'manual' as const,
            summary: hugeSummary,
            validationStatus: 'valid' as const,
            runtimeManifest: null,
            modelProvider: null,
            modelName: null,
            provenance: null,
            diff: {
              kind: 'structural' as const,
              slideCountBefore: 1,
              slideCountAfter: 1,
              assetsAdded: ['data:image/png;base64,' + 'A'.repeat(3000)],
            },
            createdAt: '2026-01-01T00:00:00.000Z',
            isActive: true,
          },
        ],
      },
    })

    const execute = tools.list_versions.execute as unknown as ToolExecute
    const output = await execute({ limit: 5 }, {})

    expect(output.versions[0].summary.length).toBeLessThanOrEqual(500)
    expect(output.versions[0].summary).not.toContain('<section')
    expect(output.versions[0].diff).toMatchObject({
      kind: 'structural',
      slideCountBefore: 1,
      slideCountAfter: 1,
      assetsAddedCount: 1,
    })
    expect(output.versions[0].diff).not.toHaveProperty('assetsAdded')
    expect(JSON.stringify(output)).not.toContain('base64,AAA')
  })
})

describe('propose_themes tool', () => {
  const sampleHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><title>Theme</title>
<style>html,body{margin:0;height:100%} .slide{width:100vw;height:100vh}</style>
</head><body><section class="slide"><h1>Title</h1></section></body></html>`

  const themes = [
    { id: 'a', name: 'Alpha', description: 'Dark', sampleHtml },
    { id: 'b', name: 'Beta', description: 'Light', sampleHtml },
    { id: 'c', name: 'Gamma', description: 'Bold', sampleHtml },
    { id: 'd', name: 'Delta', description: 'Soft', sampleHtml },
  ]

  it.each([
    ['empty', ''],
    ['existing', managedDeck],
  ])('awaits a choice for valid samples on an %s workspace', async (_kind, html) => {
    const tools = createDeckTools(createDeckWorkspace(html))
    const execute = tools.propose_themes!.execute as unknown as ToolExecute
    await expect(execute({ title: 'Pick a visual direction', themes }, {})).resolves.toMatchObject({
      ok: true,
      awaitingUserResponse: true,
    })
  })

  it('rejects invalid sampleHtml', async () => {
    const tools = createDeckTools(createDeckWorkspace(''))
    const execute = tools.propose_themes!.execute as unknown as ToolExecute
    const invalid = themes.map((theme, index) =>
      index === 0
        ? {
            ...theme,
            sampleHtml: `<!DOCTYPE html><html><body><section class="slide"><img src="https://evil.example/x.png" /></section></body></html>`,
          }
        : theme,
    )
    await expect(
      execute({ title: 'Pick a visual direction', themes: invalid }, {}),
    ).resolves.toMatchObject({
      ok: false,
      themeId: 'a',
    })
  })
})
