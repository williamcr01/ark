import { describe, expect, it } from 'vitest'

import {
  assembleDeckAgentContext,
  projectAssistantTurnForModel,
  projectAssistantTurnForPersistence,
} from './chat-context.ts'
import {
  MAX_MODEL_ASSISTANT_TURN_BYTES,
  MAX_PERSISTED_ASSISTANT_TURN_BYTES,
  type ApiChatMessage,
  type ChatMessagePart,
} from './chat.ts'

const toolStep = (stepIndex: number, id: string, summary: string, error = false) =>
  [
    {
      type: 'tool-call',
      toolName: 'read_deck',
      summary,
      stepIndex,
      toolCallId: id,
      input: { offset: stepIndex + 1, padding: 'x'.repeat(900) },
    },
    {
      type: 'tool-result',
      toolName: 'read_deck',
      summary: error ? 'read failed' : `slide ${stepIndex}`,
      stepIndex,
      toolCallId: id,
      output: error ? { error: 'read failed' } : { title: `Slide ${stepIndex}` },
      isError: error,
    },
  ] satisfies ChatMessagePart[]

describe('agent context assembly', () => {
  it('replays under-budget turns without changing durable parts', () => {
    const parts = [
      ...toolStep(0, 'call-1', 'slide 0'),
      { type: 'text', content: 'Done.', stepIndex: 1 },
    ] satisfies ChatMessagePart[]
    const before = structuredClone(parts)
    const context = assembleDeckAgentContext({
      messages: [{ role: 'assistant', content: 'Done.', parts }],
      currentHtml: '',
    })
    expect(context.metadata.omittedStepCount).toBe(0)
    expect(context.modelMessages.map(({ role }) => role)).toEqual([
      'assistant',
      'tool',
      'assistant',
    ])
    expect(parts).toEqual(before)
  })

  it('summarizes older steps while preserving recent pairing, errors, and final text', () => {
    const parts = [
      ...toolStep(0, 'call-old', 'slide 0', true),
      ...toolStep(1, 'call-new', 'slide 1'),
      { type: 'text', content: 'Final response exactly.', stepIndex: 2 },
    ] satisfies ChatMessagePart[]
    const projected = projectAssistantTurnForModel(parts, 2200)
    expect(projected.omittedStepCount).toBeGreaterThan(0)
    expect(projected.ledger).toContain('Earlier agent steps summarized')
    expect(projected.ledger).toContain('error: read failed')
    expect(projected.parts.at(-1)).toMatchObject({ content: 'Final response exactly.' })
    expect(projected.bytesAfter).toBeLessThanOrEqual(2200)
    expect(parts[0]).toMatchObject({ toolCallId: 'call-old' })
  })

  it('keeps retry-control ordering and wraps only the latest user turn', () => {
    const messages: ApiChatMessage[] = [
      { role: 'user', content: 'Create it' },
      { role: 'assistant', content: 'Failed', parts: toolStep(0, 'call-1', 'slide 0', true) },
      { role: 'user', content: 'Retry previous request' },
    ]
    const context = assembleDeckAgentContext({ messages, currentHtml: '<html></html>' })
    expect(context.modelMessages.map(({ role }) => role)).toEqual([
      'user',
      'assistant',
      'tool',
      'user',
    ])
    expect(context.modelMessages.at(-1)?.content).toContain('Retry previous request')
  })

  it('keeps durable input intact while enforcing the default model ceiling', () => {
    const parts = [
      ...toolStep(0, 'call-0', 'old'),
      { type: 'text', content: 'x'.repeat(98_000), stepIndex: 1 },
      { type: 'text', content: 'Final.', stepIndex: 2 },
    ] satisfies ChatMessagePart[]
    const before = structuredClone(parts)
    const projected = projectAssistantTurnForModel(parts)
    expect(projected.omittedStepCount).toBeGreaterThan(0)
    expect(projected.bytesAfter).toBeLessThanOrEqual(MAX_MODEL_ASSISTANT_TURN_BYTES)
    expect(parts).toEqual(before)
    expect(projected.parts.at(-1)).toMatchObject({ content: 'Final.' })
  })

  it('emits the semantic ledger as user context rather than assistant history', () => {
    const parts = [
      ...toolStep(0, 'call-old', 'old'),
      ...toolStep(1, 'call-new', 'new'),
    ] satisfies ChatMessagePart[]
    const context = assembleDeckAgentContext({
      messages: [{ role: 'assistant', content: 'Read deck.', parts }],
      currentHtml: '',
      projectionLimits: { maxAssistantTurnBytes: 1800 },
    })
    expect(context.modelMessages[0]).toMatchObject({
      role: 'user',
      content: expect.stringContaining('Earlier agent steps summarized'),
    })
  })

  it('never recommends repeating a compacted mutation', () => {
    const parts = [
      { type: 'text', content: 'x'.repeat(3000), stepIndex: 0 },
      {
        type: 'tool-call',
        toolName: 'patch_deck',
        summary: 'replace slide 2',
        stepIndex: 1,
        toolCallId: 'patch-1',
        input: { operations: [{ op: 'replace', index: 2, html: 'x'.repeat(3000) }] },
        mutating: true,
      },
      {
        type: 'tool-result',
        toolName: 'patch_deck',
        summary: 'changed slide 2',
        stepIndex: 1,
        toolCallId: 'patch-1',
        output: { changedSlideIndexes: [2] },
        mutating: true,
      },
    ] satisfies ChatMessagePart[]
    const projected = projectAssistantTurnForModel(parts, 1200)
    expect(JSON.stringify(projected)).toContain('Do not repeat patch_deck')
    expect(JSON.stringify(projected)).not.toContain('Call patch_deck again')
  })

  it('keeps the exact newest tool-ending step when it fits with the ledger', () => {
    const newest = toolStep(1, 'call-new', 'exact newest')
    const parts = [
      { type: 'text', content: 'x'.repeat(10_000), stepIndex: 0 },
      ...newest,
    ] satisfies ChatMessagePart[]
    const projected = projectAssistantTurnForModel(parts, 3000)
    expect(projected.parts).toEqual(newest)
  })

  it('bounds final assistant text that exceeds the model budget', () => {
    const projected = projectAssistantTurnForModel(
      [{ type: 'text', content: 'x'.repeat(3000), stepIndex: 0 }],
      1000,
    )
    expect(projected.bytesAfter).toBeLessThanOrEqual(1000)
    expect(projected.parts[0]).toMatchObject({
      type: 'text',
      content: expect.stringContaining('truncated for model'),
    })
  })

  it('allocates the model budget across every text part without looping', () => {
    const parts = Array.from({ length: 15 }, (_, index) => ({
      type: 'text' as const,
      content: `${index}:${'x'.repeat(10_000)}`,
      stepIndex: 0,
    }))
    const projected = projectAssistantTurnForModel(parts)
    expect(projected.bytesAfter).toBeLessThanOrEqual(MAX_MODEL_ASSISTANT_TURN_BYTES)
  })

  it('falls back to a bounded ledger when compacted tool parts cannot fit', () => {
    const parts = toolStep(0, 'call-small-limit', 'large tool step')
    for (const limit of [100, 500]) {
      const projected = projectAssistantTurnForModel(parts, limit)
      expect(projected.parts).toEqual([])
      expect(projected.bytesAfter).toBeLessThanOrEqual(limit)
    }
  })

  it('prioritizes an early error when more than 40 steps are omitted', () => {
    const parts = Array.from({ length: 50 }, (_, index) =>
      toolStep(index, `call-${index}`, `read ${index}`, index === 0),
    ).flat()
    const projected = projectAssistantTurnForModel(parts, 5000)
    expect(projected.ledger).toContain('error: read failed')
  })

  it('keeps every logical part while compacting generated turns for persistence', () => {
    const parts = [
      ...Array.from({ length: 30 }, (_, stepIndex) => [
        ...toolStep(stepIndex, `a-${stepIndex}`, `read ${stepIndex}`),
        ...toolStep(stepIndex, `b-${stepIndex}`, `read ${stepIndex}`),
      ]).flat(2),
      { type: 'text', content: 'z'.repeat(600_000), stepIndex: 30 },
    ] satisfies ChatMessagePart[]
    const projected = projectAssistantTurnForPersistence(parts)
    expect(projected).toHaveLength(parts.length)
    expect(new TextEncoder().encode(JSON.stringify(projected)).byteLength).toBeLessThanOrEqual(
      MAX_PERSISTED_ASSISTANT_TURN_BYTES,
    )
    expect(projected.filter((part) => part.type === 'tool-call')).toHaveLength(60)
    expect(projected.filter((part) => part.type === 'tool-result')).toHaveLength(60)
  })

  it('uses a persistence ledger instead of throwing when compact parts cannot fit', () => {
    const parts = Array.from({ length: 30 }, (_, index) =>
      toolStep(index, `call-${index}`, `read ${index}`),
    ).flat()
    const projected = projectAssistantTurnForPersistence(parts, 1000)
    expect(new TextEncoder().encode(JSON.stringify(projected)).byteLength).toBeLessThanOrEqual(1000)
    expect(projected).toMatchObject([
      { type: 'text', content: expect.stringContaining('Durable agent transcript compacted') },
    ])
  })
})
