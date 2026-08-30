import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'

import {
  extractAgentSteps,
  extractAgentTranscriptParts,
  hasAwaitingUserToolResult,
  runDeckAgent,
} from './deck-agent.ts'
import { createActiveDeckTools } from './deck-tool-catalog.ts'
import { createDeckWorkspace } from './deck-workspace.ts'

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

const mockCachedUsage = {
  inputTokens: {
    total: 1200,
    noCache: 200,
    cacheRead: 900,
    cacheWrite: 100,
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

const streamToolCallReply = (toolCallId: string, toolName: string, input: unknown) => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start' as const, warnings: [] },
      {
        type: 'tool-call' as const,
        toolCallId,
        toolName,
        input: JSON.stringify(input),
      },
      {
        type: 'finish' as const,
        finishReason: 'tool-calls' as const,
        usage: mockUsage,
      },
    ],
  }),
})

describe('hasAwaitingUserToolResult', () => {
  const stop = hasAwaitingUserToolResult('propose_themes')

  it('stops only when propose_themes awaits a choice', () => {
    expect(
      stop({
        steps: [
          {
            toolResults: [
              undefined,
              {
                type: 'tool-result',
                toolCallId: 't1',
                toolName: 'propose_themes',
                input: {},
                output: { ok: true, awaitingUserResponse: true },
              },
            ],
          } as never,
        ],
      }),
    ).toBe(true)
  })

  it('keeps the loop open when propose_themes validation fails', () => {
    expect(
      stop({
        steps: [
          {
            toolResults: [
              {
                type: 'tool-result',
                toolCallId: 't1',
                toolName: 'propose_themes',
                input: {},
                output: { ok: false, error: 'invalid sample', themeId: 'a' },
              },
            ],
          } as never,
        ],
      }),
    ).toBe(false)
  })
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

  it('includes thrown SDK tool errors in live summary steps', () => {
    expect(
      extractAgentSteps([
        {
          text: '',
          toolCalls: [{ toolName: 'list_slides', input: {} }],
          toolResults: [],
          content: [{ type: 'tool-error', toolName: 'list_slides', error: new Error('boom') }],
        },
      ]),
    ).toEqual([
      { type: 'tool-call', toolName: 'list_slides', summary: 'outline' },
      { type: 'tool-result', toolName: 'list_slides', summary: 'boom', error: true },
    ])
  })
})

describe('extractAgentTranscriptParts', () => {
  it('retains SDK ids and normalizes both tool error channels', () => {
    const { activeDefinitions } = createActiveDeckTools(createDeckWorkspace(sampleHtml))
    const parts = extractAgentTranscriptParts(
      [
        {
          content: [
            {
              type: 'tool-call',
              toolName: 'read_deck',
              toolCallId: 'call-1',
              input: { slideIndex: 0 },
            },
            {
              type: 'tool-result',
              toolName: 'read_deck',
              toolCallId: 'call-1',
              output: { error: 'missing' },
            },
            { type: 'tool-call', toolName: 'list_slides', toolCallId: 'call-2', input: {} },
            {
              type: 'tool-error',
              toolName: 'list_slides',
              toolCallId: 'call-2',
              error: new Error('boom'),
            },
          ],
        },
      ],
      activeDefinitions,
    )
    expect(parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool-call', toolCallId: 'call-1', stepIndex: 0 }),
        expect.objectContaining({ type: 'tool-result', toolCallId: 'call-1', isError: true }),
        expect.objectContaining({ type: 'tool-result', toolCallId: 'call-2', isError: true }),
      ]),
    )
  })

  it('persists read recovery metadata for the next job', () => {
    const { activeDefinitions } = createActiveDeckTools(createDeckWorkspace(sampleHtml))
    const parts = extractAgentTranscriptParts(
      [
        {
          content: [
            {
              type: 'tool-call',
              toolName: 'read_deck',
              toolCallId: 'call-read',
              input: { offset: 1 },
            },
            {
              type: 'tool-result',
              toolName: 'read_deck',
              toolCallId: 'call-read',
              output: {
                mode: 'lines',
                content: 'x'.repeat(10_000),
                offset: 1,
                totalLines: 2,
                truncated: true,
                nextOffset: 2,
              },
            },
          ],
        },
      ],
      activeDefinitions,
    )
    expect(parts[1]).toMatchObject({
      type: 'tool-result',
      truncated: true,
      recovery: { toolName: 'read_deck', input: { offset: 2 } },
      output: { content: 'x'.repeat(10_000), nextOffset: 2 },
    })
  })
})

describe('runDeckAgent prompt caching', () => {
  /**
   * Capture the converted model calls so we can assert what the provider receives.
   * Runs a two-step loop (tool call, then summary) so per-step options are covered.
   */
  const recordingModel = () => {
    const calls: LanguageModelV3CallOptions[] = []
    const replies = [
      streamToolCallReply('call-edit', 'edit_deck', {
        edits: [{ oldText: 'Hello', newText: 'Cached' }],
      }),
      streamTextReply('Updated the title.'),
    ]
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        calls.push(options)
        return replies.shift()!
      },
    })
    return { calls, model }
  }

  const anthropicCacheControl = { cacheControl: { type: 'ephemeral' } }

  const cacheControlOf = (message: LanguageModelV3CallOptions['prompt'][number]) => {
    if (message.providerOptions?.anthropic) return message.providerOptions.anthropic
    if (!Array.isArray(message.content)) return undefined
    const last = message.content.at(-1)
    return last && 'providerOptions' in last ? last.providerOptions?.anthropic : undefined
  }

  const nonSystemMessages = (prompt: LanguageModelV3CallOptions['prompt']) =>
    prompt.filter((message) => message.role !== 'system')

  it('marks Anthropic system prefix and trailing transcript on every step', async () => {
    const { calls, model } = recordingModel()

    const result = await runDeckAgent({
      model,
      provider: 'anthropic',
      modelRef: 'anthropic:claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'Update the title' }],
      currentHtml: sampleHtml,
      promptCacheKey: 'deck-1',
    })

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
    for (const [step, call] of calls.entries()) {
      const system = call.prompt[0]
      expect(system.role).toBe('system')
      expect(system.providerOptions).toEqual({ anthropic: anthropicCacheControl })
      expect(call.providerOptions?.openai).toBeUndefined()

      const transcript = nonSystemMessages(call.prompt)
      expect(transcript.length).toBeGreaterThan(0)
      const trailing = transcript.slice(-Math.min(2, transcript.length))
      for (const message of trailing) {
        expect(cacheControlOf(message)).toEqual(anthropicCacheControl)
      }
      if (step === 1) {
        expect(transcript.length).toBeGreaterThan(1)
        expect(cacheControlOf(transcript.at(-1)!)).toEqual(anthropicCacheControl)
        if (transcript.length > 2) {
          expect(cacheControlOf(transcript[0])).toBeUndefined()
        }
      }
    }
  })

  it('sends the opaque promptCacheKey to OpenAI alongside reasoning options', async () => {
    const { calls, model } = recordingModel()
    const opaqueKey = 'deck-1'

    const result = await runDeckAgent({
      model,
      provider: 'openai',
      modelRef: 'openai:gpt-5.6-sol',
      messages: [{ role: 'user', content: 'Update the title' }],
      currentHtml: sampleHtml,
      reasoningEffort: 'high',
      promptCacheKey: opaqueKey,
    })

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.providerOptions?.openai).toMatchObject({
        promptCacheKey: opaqueKey,
        reasoningEffort: 'high',
      })
      expect(String(call.providerOptions?.openai?.promptCacheKey)).toBe(opaqueKey)
      expect(JSON.stringify(call.providerOptions)).not.toContain('Update the title')
      expect(call.prompt[0].providerOptions).toBeUndefined()
    }
  })

  it('omits cache options entirely for Google (implicit caching, telemetry only)', async () => {
    const { calls, model } = recordingModel()

    const result = await runDeckAgent({
      model,
      provider: 'google',
      modelRef: 'google:gemini-2.5-pro',
      messages: [{ role: 'user', content: 'Update the title' }],
      currentHtml: sampleHtml,
      promptCacheKey: 'deck-1',
    })

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.prompt[0].providerOptions).toBeUndefined()
      expect(call.providerOptions).toBeUndefined()
      for (const message of call.prompt) {
        expect(cacheControlOf(message)).toBeUndefined()
      }
    }
  })

  it('omits OpenAI promptCacheKey when no opaque id is available', async () => {
    const { calls, model } = recordingModel()

    const result = await runDeckAgent({
      model,
      provider: 'openai',
      modelRef: 'openai:gpt-5.6-sol',
      messages: [{ role: 'user', content: 'Update the title' }],
      currentHtml: sampleHtml,
    })

    expect(result.ok).toBe(true)
    expect(calls[0].providerOptions).toBeUndefined()
  })

  it('does not send Anthropic cacheControl or OpenAI promptCacheKey for other providers', async () => {
    const { calls, model } = recordingModel()

    const result = await runDeckAgent({
      model,
      provider: 'xai',
      modelRef: 'xai:grok-4',
      messages: [{ role: 'user', content: 'Update the title' }],
      currentHtml: sampleHtml,
      promptCacheKey: 'deck-1',
    })

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.providerOptions?.openai).toBeUndefined()
      for (const message of call.prompt) {
        expect(cacheControlOf(message)).toBeUndefined()
      }
    }
  })
})

describe('runDeckAgent', () => {
  it('exposes step-summed prompt-cache token usage in provider metrics', async () => {
    const replies = [
      streamToolCallReply('call-edit', 'edit_deck', {
        edits: [{ oldText: 'Hello', newText: 'Cached' }],
      }),
      {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'Updated the title.' },
            { type: 'text-end', id: 'text-1' },
            {
              type: 'finish',
              finishReason: 'stop' as const,
              usage: mockCachedUsage,
            },
          ],
        }),
      },
    ]
    const model = new MockLanguageModelV3({
      doStream: async () => replies.shift()!,
    })

    const result = await runDeckAgent({
      model,
      provider: 'anthropic',
      modelRef: 'anthropic:claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'Update the title' }],
      currentHtml: sampleHtml,
      promptCacheKey: 'deck-1',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // totalUsage sums every step; first step uses mockUsage, second mockCachedUsage.
    expect(result.providerMetrics.tokenUsage).toMatchObject({
      inputTokens: 1210,
      outputTokens: 16,
      totalTokens: 1226,
      noCacheTokens: 210,
      cacheReadTokens: 900,
      cacheWriteTokens: 100,
    })
  })

  it('continues after parse_deck so a later step can update the deck', async () => {
    const replies = [
      streamToolCallReply('call-parse', 'parse_deck', {}),
      streamToolCallReply('call-edit', 'edit_deck', {
        edits: [{ oldText: 'Hello', newText: 'Updated' }],
      }),
      streamTextReply('Updated the title.'),
    ]
    const model = new MockLanguageModelV3({
      doStream: async () => replies.shift()!,
    })

    const result = await runDeckAgent({
      model,
      provider: 'mock',
      modelRef: 'mock:model',
      messages: [{ role: 'user', content: 'Inspect, then update the title' }],
      currentHtml: sampleHtml,
    })

    expect(model.doStreamCalls).toHaveLength(3)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.html).toContain('Updated')
  })

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
    const progressSnapshots: Array<Array<{ type: string; summary: string; durationMs?: number }>> =
      []
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
        progressSnapshots.push(
          steps.map((step) => ({
            type: step.type,
            summary: step.summary,
            ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}),
          })),
        )
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    const thinkingStep = result.steps.find((step) => step.type === 'thinking')
    expect(thinkingStep?.summary).toContain('Plan A')
    expect(typeof thinkingStep?.durationMs).toBe('number')
    expect(
      progressSnapshots.some((steps) =>
        steps.some(
          (step) =>
            step.type === 'thinking' &&
            step.summary.includes('Plan A') &&
            step.durationMs === undefined,
        ),
      ),
    ).toBe(true)
  })

  it('returns the provider error when the stream fails before producing output', async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'error', error: new Error('This model is no longer available.') },
          ],
        }),
      },
    })

    const result = await runDeckAgent({
      model,
      provider: 'google',
      modelRef: 'google:gemini-2.5-flash',
      messages: [{ role: 'user', content: 'Create a deck' }],
      currentHtml: '',
    })

    expect(result).toMatchObject({
      ok: false,
      error: 'This model is no longer available.',
    })
    expect(model.doStreamCalls[0]?.temperature).toBeUndefined()
  })
})
