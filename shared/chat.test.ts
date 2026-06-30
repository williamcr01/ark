import { describe, expect, it } from 'vitest'

import {
  buildModelMessages,
  normalizeGenerateMessages,
  wrapUserPromptForGeneration,
} from './chat.ts'

describe('normalizeGenerateMessages', () => {
  it('prefers the messages array when provided', () => {
    expect(
      normalizeGenerateMessages({
        prompt: 'ignored',
        messages: [
          { role: 'user', content: 'First turn' },
          { role: 'assistant', content: 'Done.' },
          { role: 'user', content: 'Second turn' },
        ],
      }),
    ).toEqual([
      { role: 'user', content: 'First turn' },
      { role: 'assistant', content: 'Done.' },
      { role: 'user', content: 'Second turn' },
    ])
  })

  it('falls back to prompt for backward compatibility', () => {
    expect(normalizeGenerateMessages({ prompt: '  Make a deck  ' })).toEqual([
      { role: 'user', content: 'Make a deck' },
    ])
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
