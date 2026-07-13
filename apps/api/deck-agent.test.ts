import { describe, expect, it } from 'vitest'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'

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

const streamTextReply = (text: string) => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: text },
      { type: 'text-end', id: 'text-1' },
      {
        type: 'finish',
        finishReason: 'stop' as const,
        usage: mockUsage,
      },
    ],
  }),
})

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

  it('includes thinking from reasoningText', () => {
    const steps = extractAgentSteps([
      {
        text: 'Done.',
        reasoningText: 'I should inspect first.',
        toolCalls: [],
        toolResults: [],
      },
    ])

    expect(steps).toEqual([
      { type: 'thinking', summary: 'I should inspect first.' },
      { type: 'text', summary: 'Done.' },
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
      doStream: streamTextReply(assistantText),
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

  it('streams reasoning deltas into thinking progress', async () => {
    const progressSnapshots: Array<Array<{ type: string; summary: string }>> = []
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunkDelayInMs: 0,
          initialDelayInMs: 0,
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'reasoning-start', id: 'r1' },
            { type: 'reasoning-delta', id: 'r1', delta: 'Plan A' },
            { type: 'reasoning-delta', id: 'r1', delta: ' then B' },
            { type: 'reasoning-end', id: 'r1' },
            { type: 'text-start', id: 'text-1' },
            {
              type: 'text-delta',
              id: 'text-1',
              delta:
                'That selected element is locked, so I cannot change it directly. I can edit nearby unlocked content instead.',
            },
            { type: 'text-end', id: 'text-1' },
            {
              type: 'finish',
              finishReason: 'stop',
              usage: mockUsage,
            },
          ],
        }),
      },
    })

    const result = await runDeckAgent({
      model,
      provider: 'openai',
      modelRef: 'openai:gpt-5',
      messages: [{ role: 'user', content: 'Make this punchier' }],
      currentHtml: sampleHtml,
      reasoningEffort: 'high',
      editorSelection: {
        slideIndex: 0,
        elementId: 'ark-el-title',
        elementKind: 'text',
        locked: true,
      },
      onStepProgress: async (steps) => {
        progressSnapshots.push(steps.map((step) => ({ type: step.type, summary: step.summary })))
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(
      result.steps.some((step) => step.type === 'thinking' && step.summary.includes('Plan A')),
    ).toBe(true)
    expect(progressSnapshots.some((steps) => steps.some((step) => step.type === 'thinking'))).toBe(
      true,
    )
  })
})
