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
    const projected = writeDeck.projectInputForTranscript({ html })
    expect(JSON.stringify(projected)).toContain('sha256:')
    expect(JSON.stringify(projected)).toContain('re-read the current deck')
    expect(JSON.stringify(projected)).not.toContain('x'.repeat(1_000))
  })
})
