import { describe, expect, it, vi } from 'vitest'

import { createMcpInteractionStore, McpInteractionError } from './mcp-interactions.ts'

const target = {
  deckId: '00000000-0000-4000-8000-000000000001',
  baseDocumentRevision: 1,
  clientName: 'Codex',
} as const

describe('MCP interactions', () => {
  it('publishes a question and returns the in-app answer only to its client session', async () => {
    const onChanged = vi.fn()
    const store = createMcpInteractionStore(onChanged)
    const interaction = store.create(
      {
        ...target,
        kind: 'questions',
        request: {
          title: 'A few details',
          questions: [{ id: 'audience', question: 'Who is this for?', type: 'text' }],
        },
      },
      'session-a',
    )

    expect(store.getPending()).toEqual(interaction)
    await expect(store.wait(interaction.id, 'session-b', 0)).rejects.toBeInstanceOf(
      McpInteractionError,
    )

    store.respond(interaction.id, {
      kind: 'questions',
      answers: { audience: 'Executive leadership' },
    })

    await expect(store.wait(interaction.id, 'session-a', 0)).resolves.toMatchObject({
      status: 'answered',
      answer: { kind: 'questions', answers: { audience: 'Executive leadership' } },
    })
    expect(store.getPending()).toBeNull()
    expect(onChanged).toHaveBeenLastCalledWith({ interaction: null })
  })

  it('validates theme choices and marks interactions stale when the target changes', async () => {
    const store = createMcpInteractionStore()
    const interaction = store.create(
      {
        ...target,
        kind: 'themes',
        request: {
          title: 'Pick a direction',
          themes: Array.from({ length: 4 }, (_, index) => ({
            id: `theme-${index}`,
            name: `Theme ${index}`,
            description: `Direction ${index}`,
            sampleHtml:
              '<!doctype html><html><body><section class="slide"></section></body></html>',
          })),
        },
      },
      'session-a',
    )

    expect(() => store.respond(interaction.id, { kind: 'themes', themeId: 'missing' })).toThrow(
      'Unknown theme choice',
    )

    store.cancelForTarget(target.deckId, 2)
    await expect(store.wait(interaction.id, 'session-a', 0)).resolves.toMatchObject({
      status: 'stale',
    })
  })
})
