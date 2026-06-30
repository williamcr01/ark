import { describe, expect, it } from 'vitest'

import {
  agentStepsToChatParts,
  buildAgentModelMessages,
  buildAssistantMessageContent,
  buildModelMessages,
  parseGenerateMessages,
  wrapUserPromptForGeneration,
} from './chat.ts'

describe('parseGenerateMessages', () => {
  it('trims and filters empty messages', () => {
    expect(
      parseGenerateMessages([
        { role: 'user', content: '  First turn  ' },
        { role: 'assistant', content: 'Done.' },
        { role: 'user', content: '   ' },
        { role: 'user', content: 'Second turn' },
      ]),
    ).toEqual({
      ok: true,
      messages: [
        { role: 'user', content: 'First turn' },
        { role: 'assistant', content: 'Done.' },
        { role: 'user', content: 'Second turn' },
      ],
    })
  })

  it('returns an error when messages are missing or not an array', () => {
    expect(parseGenerateMessages(undefined)).toEqual({
      ok: false,
      error: 'messages must be an array.',
    })
    expect(parseGenerateMessages('hello')).toEqual({
      ok: false,
      error: 'messages must be an array.',
    })
    expect(parseGenerateMessages({ role: 'user', content: 'hi' })).toEqual({
      ok: false,
      error: 'messages must be an array.',
    })
  })

  it('rejects malformed message objects and invalid roles', () => {
    expect(parseGenerateMessages([null])).toEqual({
      ok: false,
      error: 'messages[0] must be an object.',
    })
    expect(parseGenerateMessages([{ role: 'system', content: 'nope' }])).toEqual({
      ok: false,
      error: 'messages[0].role must be "user" or "assistant".',
    })
    expect(parseGenerateMessages([{ role: 'user', content: 42 }])).toEqual({
      ok: false,
      error: 'messages[0].content must be a string.',
    })
  })
})

describe('buildModelMessages', () => {
  it('wraps only the latest user turn with the current HTML', () => {
    const messages = buildModelMessages(
      [
        { role: 'user', content: 'Create a deck about cats' },
        { role: 'assistant', content: 'Generated the deck.' },
        { role: 'user', content: 'Make the title larger' },
      ],
      '<html><body><section class="slide">cats</section></body></html>',
    )

    expect(messages).toHaveLength(3)
    expect(messages[0]?.content).toBe('Create a deck about cats')
    expect(messages[1]?.content).toBe('Generated the deck.')
    expect(messages[2]?.content).toContain('Make the title larger')
    expect(messages[2]?.content).toContain('<html>')
  })

  it('uses the new-deck template when there is no current HTML', () => {
    const messages = buildModelMessages(
      [{ role: 'user', content: 'Investor update deck' }],
      '',
    )

    expect(messages[0]?.content).toContain('Create a new complete Ark HTML slide deck')
    expect(messages[0]?.content).toContain('Investor update deck')
  })
})

describe('buildAgentModelMessages', () => {
  it('does not embed full HTML in the latest user turn', () => {
    const messages = buildAgentModelMessages(
      [{ role: 'user', content: 'Make the title larger' }],
      '<html><body><section class="slide">cats</section></body></html>',
    )

    expect(messages[0]?.content).toContain('Make the title larger')
    expect(messages[0]?.content).toContain('read_deck')
    expect(messages[0]?.content).not.toContain('<section class="slide">')
  })
})

describe('agentStepsToChatParts', () => {
  it('converts agent steps into persisted chat parts', () => {
    expect(
      agentStepsToChatParts([
        { type: 'tool-call', toolName: 'read_deck', summary: 'lines 1–100' },
        { type: 'tool-result', toolName: 'edit_deck', summary: 'Applied 1 edit(s)' },
        { type: 'text', summary: 'Done.' },
      ]),
    ).toEqual([
      { type: 'tool-call', toolName: 'read_deck', summary: 'lines 1–100' },
      { type: 'tool-result', toolName: 'edit_deck', summary: 'Applied 1 edit(s)' },
      { type: 'text', content: 'Done.' },
    ])
  })
})

describe('buildAssistantMessageContent', () => {
  it('falls back to the last successful tool result summary', () => {
    expect(
      buildAssistantMessageContent('', [
        { type: 'tool-result', toolName: 'write_deck', summary: 'Deck written' },
      ], false),
    ).toBe('Deck written')
  })
})

describe('wrapUserPromptForGeneration', () => {
  it('documents revision vs create wording', () => {
    expect(wrapUserPromptForGeneration('edit', '<html></html>')).toContain(
      'revise the existing Ark HTML deck',
    )
    expect(wrapUserPromptForGeneration('create', '')).toContain(
      'Create a new complete Ark HTML slide deck',
    )
  })
})
