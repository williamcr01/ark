import { describe, expect, it } from 'vitest'
import { MockLanguageModelV3 } from 'ai/test'

import { extractAgentSteps, runDeckAgent } from './deck-agent.ts'

const sampleHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Deck</title>
</head>
<body>
  <section class="slide"><h1 data-ark-id="ark-el-title">Hello</h1></section>
</body>
</html>`

const mockUsage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 8,
    text: 8,
    reasoning: 0,
  },
}

describe('extractAgentSteps', () => {
  it('maps tool calls and results into chat-friendly steps', () => {
    const steps = extractAgentSteps([
      {
        text: 'Inspecting the deck.',
        toolCalls: [{ toolName: 'list_slides', input: {} }],
        toolResults: [
          {
            toolName: 'list_slides',
            output: { slideCount: 3, slides: [] },
          },
        ],
      },
      {
        text: '',
        toolCalls: [{ toolName: 'edit_deck', input: { edits: [{ oldText: 'a', newText: 'b' }] } }],
        toolResults: [
          {
            toolName: 'edit_deck',
            output: { ok: false, error: 'oldText was not found' },
          },
        ],
      },
    ])

    expect(steps).toEqual([
      { type: 'text', summary: 'Inspecting the deck.' },
      { type: 'tool-call', toolName: 'list_slides', summary: 'outline' },
      { type: 'tool-result', toolName: 'list_slides', summary: '3 slide(s)', error: false },
      { type: 'tool-call', toolName: 'edit_deck', summary: '1 patch(es)' },
      {
        type: 'tool-result',
        toolName: 'edit_deck',
        summary: 'oldText was not found',
        error: true,
      },
    ])
  })

  it('summarizes patch_deck tool activity', () => {
    const steps = extractAgentSteps([
      {
        text: '',
        toolCalls: [
          {
            toolName: 'patch_deck',
            input: {
              operations: [{ op: 'update_slide_title', slideIndex: 0, title: 'New title' }],
            },
          },
        ],
        toolResults: [
          {
            toolName: 'patch_deck',
            output: {
              ok: true,
              summary: 'Updated title on slide 0.',
              changedSlideIndexes: [0],
            },
          },
        ],
      },
    ])

    expect(steps).toEqual([
      { type: 'tool-call', toolName: 'patch_deck', summary: '1 op(s)' },
      {
        type: 'tool-result',
        toolName: 'patch_deck',
        summary: 'Updated title on slide 0.',
        error: false,
      },
    ])
  })
})

describe('runDeckAgent', () => {
  it('accepts selected-element explanation replies as unchanged success', async () => {
    const assistantText =
      'That selected element is locked, so I cannot change it directly. I can edit nearby unlocked content instead.'
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: 'text', text: assistantText }],
        finishReason: 'stop',
        usage: mockUsage,
        warnings: [],
      },
    })

    const result = await runDeckAgent({
      model,
      provider: 'mock',
      modelRef: 'mock:model',
      messages: [{ role: 'user', content: 'Make this punchier' }],
      currentHtml: sampleHtml,
      editorSelection: {
        slideIndex: 0,
        elementId: 'ark-el-title',
        elementKind: 'text',
        locked: true,
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.changed).toBe(false)
    expect(result.html).toBe(sampleHtml)
    expect(result.assistantText).toBe(assistantText)
    expect(result.validation.valid).toBe(true)
  })
})
