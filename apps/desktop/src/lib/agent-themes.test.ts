import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@ark/chat/chat.ts'
import { findThemeChoiceAfter, isThemeChoiceMessage } from '@/lib/agent-themes'

const sampleHtml = `<!DOCTYPE html><html><body><section class="slide"><h1>Title</h1></section></body></html>`

const proposal: ChatMessage = {
  id: 'a1',
  role: 'assistant',
  content: 'Pick a direction',
  parts: [
    {
      type: 'tool-call',
      toolName: 'propose_themes',
      summary: '4 theme(s)',
      input: {
        title: 'Pick a visual direction',
        themes: [
          { id: 'midnight', name: 'Midnight Editorial', description: 'Dark', sampleHtml },
          { id: 'sunlit', name: 'Sunlit Studio', description: 'Warm', sampleHtml },
          { id: 'signal', name: 'Signal Grid', description: 'Bold', sampleHtml },
          { id: 'folio', name: 'Quiet Folio', description: 'Soft', sampleHtml },
        ],
      },
    },
  ],
}

describe('agent theme chat helpers', () => {
  it('only suppresses parseable theme choice messages', () => {
    const choice: ChatMessage = {
      id: 'u2',
      role: 'user',
      content: 'Pick a visual direction: theme choice:\n- Theme: Midnight Editorial (id: midnight)',
    }
    const freeform: ChatMessage = {
      id: 'u3',
      role: 'user',
      content: 'Actually make it more playful',
    }

    expect(isThemeChoiceMessage([proposal, choice], 1)).toBe(true)
    expect(isThemeChoiceMessage([proposal, freeform], 1)).toBe(false)
    expect(findThemeChoiceAfter([proposal, choice], 0)?.content).toContain('id: midnight')
    expect(findThemeChoiceAfter([proposal, freeform], 0)).toBeNull()
  })
})
