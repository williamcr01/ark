import { describe, expect, it } from 'vitest'

import { buildDeckAgentSystemPrompt } from './deck-agent.ts'
import { createActiveDeckTools } from './deck-tool-catalog.ts'
import { createDeckWorkspace } from './deck-workspace.ts'

describe('deck tool catalog', () => {
  it('keeps registered tools and prompt availability in sync', () => {
    const withoutVersions = createActiveDeckTools(createDeckWorkspace(''))
    const prompt = buildDeckAgentSystemPrompt(withoutVersions.activeDefinitions)
    expect(withoutVersions.activeDefinitions.map(({ name }) => name)).toEqual(
      Object.keys(withoutVersions.tools),
    )
    expect(prompt).not.toContain('**list_versions**')
    expect(prompt).toContain('self-contained')
    expect(prompt).toContain('16:9')

    const withVersions = createActiveDeckTools(createDeckWorkspace(''), {
      versionInspector: { listVersions: async () => [] },
    })
    expect(buildDeckAgentSystemPrompt(withVersions.activeDefinitions)).toContain(
      '**list_versions**',
    )
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
})
