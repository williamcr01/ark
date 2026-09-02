import { describe, expect, it } from 'vitest'

import { exampleDeckThemes } from '@ark/deck/document/theme.ts'
import { assembleDeckAgentContext, buildAgentModelMessages } from '@ark/chat/chat-context.ts'
import { MAX_EDITOR_SELECTIONS, type ApiChatMessage, type ChatMessagePart } from '@ark/chat/chat.ts'

import {
  describeEditorSelections,
  describeSlideContexts,
  wrapUserPromptForAgent,
} from './prompt.ts'

const sampleAttachment = {
  type: 'file' as const,
  mediaType: 'image/png',
  filename: 'logo.png',
  url: 'data:image/png;base64,AAAA',
}

const toolStep = (
  stepIndex: number,
  id: string,
  summary: string,
  error = false,
): ChatMessagePart[] => [
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
]

describe('buildAgentModelMessages', () => {
  it('does not embed full HTML in the latest user turn', () => {
    const messages = buildAgentModelMessages(
      [{ role: 'user', content: 'Make the title larger' }],
      '<html><body><section class="slide">cats</section></body></html>',
      undefined,
      undefined,
      undefined,
      undefined,
      wrapUserPromptForAgent,
    )

    expect(messages[0]?.role).toBe('user')
    expect(messages[0]?.content).toContain('Make the title larger')
    expect(messages[0]?.content).toContain('available tools')
    expect(JSON.stringify(messages[0]?.content)).not.toContain('<section class="slide">')
  })

  it('includes file parts for attached user turns', () => {
    const messages = buildAgentModelMessages(
      [
        {
          role: 'user',
          content: 'Match this branding',
          attachments: [sampleAttachment],
        },
      ],
      '',
      undefined,
      undefined,
      undefined,
      undefined,
      wrapUserPromptForAgent,
    )

    expect(messages).toHaveLength(1)
    expect(Array.isArray(messages[0]?.content)).toBe(true)

    const content = messages[0]?.content as Array<{ type: string; text?: string }>
    expect(content[0]).toMatchObject({
      type: 'file',
      mediaType: 'image/png',
    })
    expect(content[1]?.type).toBe('text')
    expect(content[1]?.text).toContain('attached 1 file')
  })

  it('inlines CSV attachments as text parts for model input', () => {
    const csv = 'name,value\none,1'
    const messages = buildAgentModelMessages(
      [
        {
          role: 'user',
          content: 'Build charts from this',
          attachments: [
            {
              type: 'file',
              mediaType: 'text/csv',
              filename: 'data.csv',
              url: `data:text/csv;base64,${Buffer.from(csv, 'utf8').toString('base64')}`,
            },
          ],
        },
      ],
      '',
      undefined,
      undefined,
      undefined,
      undefined,
      wrapUserPromptForAgent,
    )

    const content = messages[0]?.content as Array<{ type: string; text?: string }>
    expect(content[0]).toMatchObject({
      type: 'text',
      text: `Attached file "data.csv" (text/csv):\n${csv}`,
    })
    expect(content[1]?.type).toBe('text')
    expect(content[1]?.text).toContain('attached 1 file')
  })

  it('injects editor selection context into the latest user turn', () => {
    const messages = buildAgentModelMessages(
      [{ role: 'user', content: 'make this punchier' }],
      '<html><body><section class="slide">cats</section></body></html>',
      {
        slideIndex: 1,
        slideId: 'ark-slide-abc',
        elementId: 'ark-el-42',
        elementKind: 'text',
        textPreview: 'Our Mission',
        locked: false,
        managed: true,
      },
      undefined,
      undefined,
      undefined,
      wrapUserPromptForAgent,
    )

    const content = messages[0]?.content as string
    expect(content).toContain('make this punchier')
    expect(content).toContain('ark-el-42')
    expect(content).toContain('slide 1')
    expect(content).toContain('Our Mission')
    expect(content).toContain('patch_element')
  })

  it('adds lock guidance when the selected element is locked', () => {
    const messages = buildAgentModelMessages(
      [{ role: 'user', content: 'change this' }],
      '<html><body><section class="slide">cats</section></body></html>',
      {
        slideIndex: 0,
        elementId: 'ark-el-7',
        locked: true,
      },
      undefined,
      undefined,
      undefined,
      wrapUserPromptForAgent,
    )

    const content = messages[0]?.content as string
    expect(content).toContain('locked')
    expect(content).toMatch(/cannot be changed|safe patch/)
  })

  it('omits selection context when none is provided', () => {
    const messages = buildAgentModelMessages(
      [{ role: 'user', content: 'update the deck' }],
      '<html><body><section class="slide">cats</section></body></html>',
      undefined,
      undefined,
      undefined,
      undefined,
      wrapUserPromptForAgent,
    )

    const content = messages[0]?.content as string
    expect(content).not.toContain('selected in the editor')
  })

  it('lists every selected element id for multi-select prompts', () => {
    const messages = buildAgentModelMessages(
      [{ role: 'user', content: 'make these the same size' }],
      '<html><body><section class="slide">cats</section></body></html>',
      { slideIndex: 1, elementId: 'ark-el-primary', elementKind: 'text' },
      undefined,
      undefined,
      [
        { slideIndex: 1, elementId: 'ark-el-a', elementKind: 'text', textPreview: 'Alpha' },
        { slideIndex: 1, elementId: 'ark-el-primary', elementKind: 'text' },
        { slideIndex: 1, elementId: 'ark-el-c', locked: true },
      ],
      wrapUserPromptForAgent,
    )

    const content = messages[0]?.content as string
    expect(content).toContain('make these the same size')
    expect(content).toContain('3 elements selected')
    expect(content).toContain('these')
    expect(content).toContain('ark-el-a')
    expect(content).toContain('ark-el-primary')
    expect(content).toContain('ark-el-c')
    expect(content).toContain('Alpha')
    expect(content).toContain('primary / last-interacted element is id "ark-el-primary"')
    expect(content).not.toMatch(/and \d+ more/)
  })

  it('keeps stale selected ids in the prompt without throwing', () => {
    expect(() =>
      wrapUserPromptForAgent(
        'change this',
        '<html><body><section class="slide">no ids here</section></body></html>',
        0,
        { slideIndex: 0, elementId: 'ark-el-gone' },
      ),
    ).not.toThrow()
    const wrapped = wrapUserPromptForAgent(
      'change this',
      '<html><body><section class="slide">no ids here</section></body></html>',
      0,
      { slideIndex: 0, elementId: 'ark-el-gone' },
    )
    expect(wrapped).toContain('ark-el-gone')
    expect(wrapped).toContain('stale selection')
  })
})

describe('describeEditorSelections', () => {
  it('uses singular wording for one element', () => {
    const note = describeEditorSelections([
      {
        slideIndex: 1,
        elementId: 'ark-el-42',
        elementKind: 'text',
        textPreview: 'Our Mission',
      },
    ])
    expect(note).toContain('an element selected')
    expect(note).toContain('ark-el-42')
    expect(note).toContain('Our Mission')
    expect(note).not.toContain('these')
  })

  it('lists every selected id for a multi-element set', () => {
    const note = describeEditorSelections(
      [
        { slideIndex: 0, elementId: 'ark-el-a', elementKind: 'text' },
        { slideIndex: 0, elementId: 'ark-el-b', elementKind: 'image' },
        { slideIndex: 0, elementId: 'ark-el-c', locked: true },
      ],
      { slideIndex: 0, elementId: 'ark-el-b' },
    )
    expect(note).toContain('3 elements selected')
    expect(note).toContain('these')
    expect(note).toContain('them')
    expect(note).toContain('ark-el-a')
    expect(note).toContain('ark-el-b')
    expect(note).toContain('ark-el-c')
    expect(note).toContain('primary / last-interacted element is id "ark-el-b"')
    expect(note).not.toMatch(/and \d+ more/)
  })

  it('lists every id at the 32-element cap without summarizing any away', () => {
    const selections = Array.from({ length: MAX_EDITOR_SELECTIONS }, (_, index) => ({
      slideIndex: 0,
      elementId: `ark-el-${index}`,
    }))
    const note = describeEditorSelections(selections, selections[MAX_EDITOR_SELECTIONS - 1])
    expect(note).toContain(`${MAX_EDITOR_SELECTIONS} elements selected`)
    expect(note).toContain('these')
    expect(note).toContain('them')
    expect(note).toContain(
      `primary / last-interacted element is id "ark-el-${MAX_EDITOR_SELECTIONS - 1}"`,
    )
    for (const selection of selections) {
      expect(note).toContain(`id "${selection.elementId}"`)
    }
    expect(note).not.toMatch(/and \d+ more/)
  })
})

describe('describeSlideContexts', () => {
  it('returns empty string for no slides', () => {
    expect(describeSlideContexts([])).toBe('')
  })

  it('describes a single attached slide with index guidance', () => {
    const note = describeSlideContexts([{ slideIndex: 2, title: 'Market', slideId: 'ark-slide-3' }])
    expect(note).toContain('slide 2 ("Market"), slide id "ark-slide-3"')
    expect(note).toContain('slide index 2')
  })

  it('lists multiple attached slides', () => {
    const note = describeSlideContexts([{ slideIndex: 0, title: 'Title' }, { slideIndex: 1 }])
    expect(note).toContain('slide 0 ("Title")')
    expect(note).toContain('slide 1')
    expect(note).toContain('listed slide indexes')
  })
})

describe('wrapUserPromptForAgent', () => {
  it('includes slide context notes when revising an existing deck', () => {
    const wrapped = wrapUserPromptForAgent('Tighten the copy', '<html></html>', 0, undefined, [
      { slideIndex: 1, title: 'Agenda' },
    ])
    expect(wrapped).toContain('Tighten the copy')
    expect(wrapped).toContain('attached the following slide(s) as context')
    expect(wrapped).toContain('slide 1 ("Agenda")')
  })

  it('omits slide context notes for brand-new decks', () => {
    const wrapped = wrapUserPromptForAgent('Build a pitch deck', '', 0, undefined, [
      { slideIndex: 0, title: 'Title' },
    ])
    expect(wrapped).toContain('Build a pitch deck')
    expect(wrapped).not.toContain('attached the following slide(s) as context')
  })

  it('starts a new deck when the workspace only holds a blank starter deck', () => {
    const wrapped = wrapUserPromptForAgent(
      'Build a pitch deck',
      '<html><body><section class="slide"></section></body></html>',
      0,
      undefined,
      undefined,
      'blank',
    )

    expect(wrapped).toContain('Create a new complete Ark HTML slide deck')
    expect(wrapped).toContain('empty starter deck with no authored content')
    expect(wrapped).not.toContain('wants to revise')
  })

  it('revises once the deck holds authored content', () => {
    const html = '<html><body><section class="slide"><h1>Q3</h1></section></body></html>'

    expect(
      wrapUserPromptForAgent('Tighten the copy', html, 0, undefined, undefined, 'authored'),
    ).toContain('wants to revise')
    // An unknown or absent origin must not turn a real deck into a rewrite.
    expect(wrapUserPromptForAgent('Tighten the copy', html)).toContain('wants to revise')
  })

  it('lists every selected id when wrapping a multi-select revision', () => {
    const wrapped = wrapUserPromptForAgent(
      'make these the same size',
      '<html></html>',
      0,
      { slideIndex: 0, elementId: 'ark-el-primary' },
      undefined,
      undefined,
      [
        { slideIndex: 0, elementId: 'ark-el-a' },
        { slideIndex: 0, elementId: 'ark-el-primary' },
        { slideIndex: 0, elementId: 'ark-el-z' },
      ],
    )
    expect(wrapped).toContain('make these the same size')
    expect(wrapped).toContain('ark-el-a')
    expect(wrapped).toContain('ark-el-primary')
    expect(wrapped).toContain('ark-el-z')
    expect(wrapped).toContain('3 elements selected')
  })

  it('includes the selected theme contract when wrapping a new deck', () => {
    const theme = exampleDeckThemes().midnight
    const wrapped = wrapUserPromptForAgent(
      'Midnight Editorial (id: midnight)',
      '',
      0,
      undefined,
      undefined,
      'blank',
      undefined,
      {
        themeId: 'midnight',
        name: 'Midnight Editorial',
        fonts: theme.fonts,
        theme,
      },
    )
    expect(wrapped).toContain('selected a visual theme')
    expect(wrapped).toContain(theme.signature)
    expect(wrapped).toContain('data-ark-theme')
    expect(wrapped).toContain(theme.colors.primary)
  })
})

describe('assembleDeckAgentContext prompt wrapping', () => {
  it('injects slide contexts into the latest user turn only', () => {
    const messages: ApiChatMessage[] = [
      { role: 'user', content: 'Earlier turn' },
      { role: 'assistant', content: 'Ok' },
      { role: 'user', content: 'Update this slide' },
    ]
    const context = assembleDeckAgentContext({
      messages,
      currentHtml: '<html></html>',
      slideContexts: [{ slideIndex: 3, title: 'Pricing' }],
      wrapUserPrompt: wrapUserPromptForAgent,
    })
    const last = context.modelMessages.at(-1)
    expect(typeof last?.content).toBe('string')
    expect(last?.content).toContain('Update this slide')
    expect(last?.content).toContain('slide 3 ("Pricing")')
    const earlier = context.modelMessages.find(
      (message) => message.role === 'user' && message.content === 'Earlier turn',
    )
    expect(earlier).toBeTruthy()
  })

  it('injects every editor selection id into the latest user turn only', () => {
    const messages: ApiChatMessage[] = [
      { role: 'user', content: 'Earlier turn' },
      { role: 'assistant', content: 'Ok' },
      { role: 'user', content: 'Align these' },
    ]
    const context = assembleDeckAgentContext({
      messages,
      currentHtml: '<html></html>',
      editorSelection: { slideIndex: 0, elementId: 'ark-el-primary' },
      editorSelections: [
        { slideIndex: 0, elementId: 'ark-el-a' },
        { slideIndex: 0, elementId: 'ark-el-primary' },
        { slideIndex: 0, elementId: 'ark-el-c' },
      ],
      wrapUserPrompt: wrapUserPromptForAgent,
    })
    const last = context.modelMessages.at(-1)
    expect(typeof last?.content).toBe('string')
    expect(last?.content).toContain('Align these')
    expect(last?.content).toContain('ark-el-a')
    expect(last?.content).toContain('ark-el-primary')
    expect(last?.content).toContain('ark-el-c')
    const earlier = context.modelMessages.find(
      (message) => message.role === 'user' && message.content === 'Earlier turn',
    )
    expect(earlier).toBeTruthy()
    expect(earlier?.content).not.toContain('ark-el-a')
  })

  it('keeps every selected id when older assistant steps are summarized', () => {
    const parts = [
      { type: 'text', content: 'x'.repeat(98_000), stepIndex: 0 },
      ...toolStep(1, 'call-new', 'slide 1'),
    ] satisfies ChatMessagePart[]
    const selections = Array.from({ length: MAX_EDITOR_SELECTIONS }, (_, index) => ({
      slideIndex: 0,
      elementId: `ark-el-${index}`,
    }))
    const context = assembleDeckAgentContext({
      messages: [
        { role: 'assistant', content: 'Working', parts },
        { role: 'user', content: 'Align these' },
      ],
      currentHtml: '<html></html>',
      editorSelection: selections[MAX_EDITOR_SELECTIONS - 1],
      editorSelections: selections,
      wrapUserPrompt: wrapUserPromptForAgent,
    })
    expect(context.metadata.omittedStepCount).toBeGreaterThan(0)
    const last = context.modelMessages.at(-1)
    expect(typeof last?.content).toBe('string')
    expect(last?.content).toContain('Align these')
    expect(last?.content).toContain(`${MAX_EDITOR_SELECTIONS} elements selected`)
    expect(last?.content).toContain('them')
    for (const selection of selections) {
      expect(last?.content).toContain(`id "${selection.elementId}"`)
    }
    expect(String(last?.content)).not.toMatch(/and \d+ more/)
  })
})
