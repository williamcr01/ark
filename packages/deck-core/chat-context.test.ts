import { describe, expect, it } from 'vitest'

import { assembleDeckAgentContext, projectAssistantTurnForModel } from './chat-context.ts'
import {
  MAX_MODEL_ASSISTANT_TURN_BYTES,
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
    expect(JSON.stringify(projected.parts)).toContain('Earlier agent steps summarized')
    expect(JSON.stringify(projected.parts)).toContain('error: read failed')
    expect(projected.parts.at(-1)).toMatchObject({ content: 'Final response exactly.' })
    expect(
      new TextEncoder().encode(JSON.stringify(projected.parts)).byteLength,
    ).toBeLessThanOrEqual(2200)
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
})
