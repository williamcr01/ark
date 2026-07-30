import { describe, expect, it } from 'vitest'

import { buildDeckAgentSystemPrompt } from './deck-agent.ts'
import { createActiveDeckTools } from './deck-tool-catalog.ts'
import { createDeckWorkspace } from './deck-workspace.ts'

describe('deck tool catalog', () => {
  it('keeps registered tools in sync and omits tool list from system prompt', () => {
    const withoutVersions = createActiveDeckTools(createDeckWorkspace(''))
    const prompt = buildDeckAgentSystemPrompt()
    expect(withoutVersions.activeDefinitions.map(({ name }) => name)).toEqual(
      Object.keys(withoutVersions.tools),
    )
    expect(prompt).not.toContain('Available tools:')
    expect(prompt).not.toContain('list_versions')
    expect(prompt).not.toContain('Guidelines:')
    expect(prompt).toContain('self-contained')
    expect(prompt).toContain('16:9')

    const withVersions = createActiveDeckTools(createDeckWorkspace(''), {
      versionInspector: { listVersions: async () => [] },
    })
    expect(withVersions.activeDefinitions.map(({ name }) => name)).toContain('list_versions')
    expect(withVersions.tools.list_versions?.description).toContain(
      'Use before large rewrites or when the user asks what changed.',
    )
  })

  it('offers structured user questions for new and existing decks', () => {
    const empty = createActiveDeckTools(createDeckWorkspace(''))
    expect(empty.tools.ask_user?.description).toContain('single choice')

    const existing = createActiveDeckTools(
      createDeckWorkspace(
        '<!doctype html><html><body><section class="slide">Title</section></body></html>',
      ),
    )
    expect(existing.tools.ask_user?.description).toContain('single choice')
    expect(
      existing.activeDefinitions
        .find(({ name }) => name === 'ask_user')
        ?.summarizeInput({ questions: [{}, {}] }),
    ).toBe('2 question(s)')
  })

  it('offers propose_themes for empty and existing workspaces and preserves sampleHtml', () => {
    const empty = createActiveDeckTools(createDeckWorkspace(''))
    expect(empty.tools.propose_themes?.description).toContain('four visually distinct')
    const sampleHtml = `<!DOCTYPE html><html><body><section class="slide"><h1>${'Theme'.repeat(200)}</h1></section></body></html>`
    const proposeThemes = empty.activeDefinitions.find(({ name }) => name === 'propose_themes')!
    expect(proposeThemes.summarizeInput({ themes: [{}, {}, {}, {}] })).toBe('4 theme(s)')
    const projected = proposeThemes.projectInputForTranscript({
      title: 'Pick a visual direction',
      themes: [
        {
          id: 'midnight',
          name: 'Midnight Editorial',
          description: 'Dark and sharp',
          sampleHtml,
        },
      ],
    })
    expect(JSON.stringify(projected.value)).toContain('<!DOCTYPE html>')
    expect(JSON.stringify(projected.value)).toContain('Midnight Editorial')
    expect(JSON.stringify(projected.value)).not.toContain('sha256:')
    expect(projected.truncated).toBe(false)

    const existing = createActiveDeckTools(
      createDeckWorkspace(
        '<!doctype html><html><body><section class="slide">Title</section></body></html>',
      ),
    )
    expect(existing.tools.propose_themes?.description).toContain('retheme the whole existing deck')
  })

  it('projects complete deck HTML to a bounded hash marker', () => {
    const { activeDefinitions } = createActiveDeckTools(createDeckWorkspace(''))
    const writeDeck = activeDefinitions.find(({ name }) => name === 'write_deck')!
    const html = `<!DOCTYPE html><html><body>${'x'.repeat(10_000)}</body></html>`
    const projected = writeDeck.projectInputForTranscript({ html }).value
    expect(JSON.stringify(projected)).toContain('sha256:')
    expect(JSON.stringify(projected)).toContain('re-read the current deck')
    expect(JSON.stringify(projected)).not.toContain('x'.repeat(1_000))
  })

  it('keeps read recovery metadata', () => {
    const { activeDefinitions } = createActiveDeckTools(createDeckWorkspace(''))
    const readDeck = activeDefinitions.find(({ name }) => name === 'read_deck')!
    const projected = readDeck.projectOutputForTranscript({
      mode: 'lines',
      content: 'partial',
      totalLines: 3000,
      truncated: true,
      nextOffset: 2001,
    })
    expect(projected).toMatchObject({
      truncated: true,
      recovery: { toolName: 'read_deck', input: { offset: 2001 } },
    })
    expect(projected.value).toMatchObject({ totalLines: 3000, nextOffset: 2001 })
  })

  it('preserves a 10KB single-line read without skipping to the next line', () => {
    const { activeDefinitions } = createActiveDeckTools(createDeckWorkspace(''))
    const readDeck = activeDefinitions.find(({ name }) => name === 'read_deck')!
    const content = 'x'.repeat(10_000)
    const projected = readDeck.projectOutputForTranscript({
      mode: 'lines',
      content,
      totalLines: 2,
      offset: 1,
      truncated: true,
      nextOffset: 2,
    })
    expect(projected.value).toMatchObject({ content, nextOffset: 2 })
    expect(projected.recovery?.input).toEqual({ offset: 2 })
  })

  it('stores mutation verification policy without recommending replay', () => {
    const { activeDefinitions } = createActiveDeckTools(createDeckWorkspace(''))
    const patchDeck = activeDefinitions.find(({ name }) => name === 'patch_deck')!
    const projected = patchDeck.projectInputForTranscript({
      operations: [{ op: 'replace', index: 2, html: '<section>new</section>' }],
    })
    expect(projected.value).toMatchObject({
      operations: [{ op: 'replace', index: 2, html: expect.stringContaining('sha256:') }],
    })
    expect(projected.recovery?.instruction).toContain('Do not repeat patch_deck')
    expect(projected.recovery?.toolName).toBe('read_deck')
  })

  it('retains operation names and targets across a large patch projection', () => {
    const { activeDefinitions } = createActiveDeckTools(createDeckWorkspace(''))
    const patchElement = activeDefinitions.find(({ name }) => name === 'patch_element')!
    const projected = patchElement.projectInputForTranscript({
      operations: Array.from({ length: 20 }, (_, index) => ({
        op: 'replace_text',
        slideId: `slide-${index}`,
        elementId: `element-${index}`,
        text: 'x'.repeat(10_000),
      })),
    })
    expect(projected.value).toMatchObject({
      operations: expect.arrayContaining([
        expect.objectContaining({
          op: 'replace_text',
          slideId: 'slide-0',
          elementId: 'element-0',
        }),
        expect.objectContaining({
          op: 'replace_text',
          slideId: 'slide-19',
          elementId: 'element-19',
        }),
      ]),
    })
    expect(projected.value).not.toMatchObject({ omitted: true })
  })
})
