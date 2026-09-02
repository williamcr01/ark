import { describe, expect, it } from 'vitest'

import { exampleThemeProposal } from '@ark/chat/agent-themes.ts'
import { buildDeckThemeRootCss, serializeDeckThemeSpec } from '@ark/deck/document/theme.ts'

import { createDeckTools } from './tools.ts'
import { createDeckWorkspace } from './workspace.ts'

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
  it('always registers attachment tools so the cached tool prefix stays stable', async () => {
    const tools = createDeckTools(createDeckWorkspace(managedDeck))
    expect(tools.list_attachments).toBeDefined()
    expect(tools.read_attachment).toBeDefined()

    const list = await (tools.list_attachments.execute as unknown as ToolExecute)({}, {})
    const read = await (tools.read_attachment.execute as unknown as ToolExecute)(
      { id: 'missing' },
      {},
    )

    // Zero attachments is a valid answer, not a failed call.
    expect(list).toEqual({ attachmentCount: 0, attachments: [] })
    // Reading a specific attachment that cannot exist is genuinely an error.
    expect(read).toEqual({ error: 'No attachments available for this conversation.' })
  })

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

describe('propose_themes tool', () => {
  const request = exampleThemeProposal()
  const themes = request.themes

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
      themeId: 'midnight',
    })
  })

  it('preserves registry fonts with sampleHtml on the live input schema', () => {
    const tools = createDeckTools(createDeckWorkspace(''))
    const schema = tools.propose_themes!.inputSchema as unknown as {
      parse: (value: unknown) => { themes: typeof themes }
      safeParse: (value: unknown) => { success: boolean }
    }
    const parsed = schema.parse({ title: 'Pick a visual direction', themes })

    expect(parsed.themes[0]?.fonts).toEqual(themes[0]?.fonts)
    expect(parsed.themes[0]?.theme.signature).toBe(themes[0]?.theme.signature)
    expect(parsed.themes[0]?.sampleHtml).toBe(themes[0]?.sampleHtml)
    expect(
      schema.safeParse({
        title: 'Pick a visual direction',
        themes: themes.map(({ fonts: _fonts, theme: _theme, ...rest }) => rest),
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        title: 'Pick a visual direction',
        themes: themes.map((theme, index) =>
          index === 0
            ? { ...theme, fonts: { display: 'inter', body: 'calibri', mono: 'courier-new' } }
            : theme,
        ),
      }).success,
    ).toBe(false)
  })

  it('rejects samples that do not demonstrate the theme recipes', async () => {
    const tools = createDeckTools(createDeckWorkspace(''))
    const execute = tools.propose_themes!.execute as unknown as ToolExecute
    const invalid = themes.map((theme, index) =>
      index === 0
        ? {
            ...theme,
            sampleHtml: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>X</title>
<style>html,body{margin:0}</style></head>
<body><section class="slide"><h1>Only cover</h1></section></body></html>`,
          }
        : theme,
    )
    await expect(execute({ title: request.title, themes: invalid }, {})).resolves.toMatchObject({
      ok: false,
      themeId: themes[0]?.id,
    })
  })
})

describe('write_deck theme matching', () => {
  it('rejects a write that does not embed the selected theme', async () => {
    const selected = exampleThemeProposal().themes[0]!.theme
    const tools = createDeckTools(createDeckWorkspace(''), { expectedTheme: selected })
    const execute = tools.write_deck.execute as unknown as ToolExecute
    await expect(
      execute(
        {
          html: `<!DOCTYPE html><html><body><section class="slide"><h1>Nope</h1></section></body></html>`,
        },
        {},
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('selected theme'),
    })
  })

  it('accepts a write that matches the selected contract', async () => {
    const selected = exampleThemeProposal().themes[0]!.theme
    const tools = createDeckTools(createDeckWorkspace(''), { expectedTheme: selected })
    const execute = tools.write_deck.execute as unknown as ToolExecute
    const html = `<!DOCTYPE html><html lang="en" data-ark-font-display="${selected.fonts.display}" data-ark-font-body="${selected.fonts.body}" data-ark-font-mono="${selected.fonts.mono}">
<head><script type="application/json" data-ark-theme>${serializeDeckThemeSpec(selected)}</script>
<style>${buildDeckThemeRootCss(selected)}</style></head>
<body>
<section class="slide" data-ark-slide-kind="cover" data-ark-layout="${selected.slideRecipes.cover.layout}"><h1>Cover</h1></section>
<section class="slide" data-ark-slide-kind="content" data-ark-layout="${selected.slideRecipes.content.layout}"><h2>Body</h2></section>
</body></html>`
    await expect(execute({ html }, {})).resolves.toMatchObject({
      ok: true,
      slideCount: 2,
    })
  })
})
