import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@ark/chat/messages.ts'
import { DEFAULT_THEME_FONT_PAIRING } from '@ark/chat/agent-themes.ts'
import {
  findThemeChoiceAfter,
  getThemeProposalRequest,
  isThemeChoiceMessage,
} from '@/lib/chat/agent-themes'

const sampleHtml = `<!DOCTYPE html><html><body><section class="slide"><h1>Title</h1></section></body></html>`
const fonts = { display: 'georgia', body: 'calibri', mono: 'courier-new' } as const

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
          { id: 'midnight', name: 'Midnight Editorial', description: 'Dark', fonts, sampleHtml },
          { id: 'sunlit', name: 'Sunlit Studio', description: 'Warm', fonts, sampleHtml },
          { id: 'signal', name: 'Signal Grid', description: 'Bold', fonts, sampleHtml },
          { id: 'folio', name: 'Quiet Folio', description: 'Soft', fonts, sampleHtml },
        ],
      },
    },
  ],
}

describe('agent theme chat helpers', () => {
  it('reads fonts from the proposal and does not invent a pairing', () => {
    expect(getThemeProposalRequest(proposal)?.themes[0]?.fonts).toEqual(fonts)
    expect(getThemeProposalRequest(proposal)?.themes[0]?.sampleHtml).toBe(sampleHtml)

    const withoutFonts: ChatMessage = {
      ...proposal,
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
    expect(getThemeProposalRequest(withoutFonts)?.themes[0]?.fonts).toEqual(
      DEFAULT_THEME_FONT_PAIRING,
    )
    expect(getThemeProposalRequest(withoutFonts)?.themes[0]?.sampleHtml).toBe(sampleHtml)
  })

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
