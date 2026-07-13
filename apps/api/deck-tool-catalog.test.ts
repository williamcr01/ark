import { describe, expect, it } from 'vitest'

import { buildDeckAgentSystemPrompt } from './deck-agent.ts'
import { capTranscriptParts, createActiveDeckTools } from './deck-tool-catalog.ts'
import { MAX_TRANSCRIPT_TURN_CHARS, type ChatMessagePart } from '@ark/deck-core/chat.ts'
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

  it('retains recent complete steps and marks omitted history', () => {
    const parts: ChatMessagePart[] = Array.from({ length: 6 }, (_, stepIndex) => ({
      type: 'text',
      stepIndex,
      content: `${stepIndex}:${'x'.repeat(20_000)}`,
    }))
    const capped = capTranscriptParts(parts)
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(MAX_TRANSCRIPT_TURN_CHARS)
    expect(capped[0]).toMatchObject({
      type: 'text',
      content: expect.stringContaining('earlier transcript step'),
    })
    expect(capped.at(-1)).toMatchObject({ type: 'text', stepIndex: 5 })
    expect(
      capped.some(
        (part) => part.stepIndex === 0 && part.type === 'text' && part.content.startsWith('0:'),
      ),
    ).toBe(false)
  })

  it('keeps an oversized newest tool step replayable with compact values', () => {
    const parts: ChatMessagePart[] = [
      {
        type: 'tool-call',
        toolName: 'read_deck',
        summary: 'large read',
        stepIndex: 0,
        toolCallId: 'call-large',
        input: { query: 'x'.repeat(MAX_TRANSCRIPT_TURN_CHARS) },
      },
      {
        type: 'tool-result',
        toolName: 'read_deck',
        summary: 'large result',
        stepIndex: 0,
        toolCallId: 'call-large',
        output: { html: 'y'.repeat(MAX_TRANSCRIPT_TURN_CHARS) },
      },
    ]

    const capped = capTranscriptParts(parts)
    expect(capped.map(({ type }) => type)).toEqual(['tool-call', 'tool-result'])
    expect(JSON.stringify(capped)).toContain('Transcript step exceeded limit')
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(MAX_TRANSCRIPT_TURN_CHARS)
  })
})
