import { describe, expect, it } from 'vitest'

import {
  agentStepsToChatParts,
  applyResolvedAssetAttachments,
  buildAssistantMessageContent,
  buildModelMessages,
  chatAttachmentsToModelParts,
  collectAssetIds,
  collectAssetIdsFromMessages,
  describeSlideContexts,
  isReadableTextMediaType,
  MAX_INLINE_TEXT_ATTACHMENT_CHARS,
  parseGenerateMessages,
  MAX_PERSISTED_TOOL_VALUE_BYTES,
  wrapUserPromptForAgent,
  wrapUserPromptForGeneration,
} from './chat.ts'
import { buildAgentModelMessages, convertChatHistoryToModelMessages } from './chat-context.ts'

const ASSET_ID = '00000000-0000-4000-8000-000000000901'

const sampleAttachment = {
  type: 'file' as const,
  mediaType: 'image/png',
  filename: 'logo.png',
  url: 'data:image/png;base64,AAAA',
}

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

  it('rejects oversized replay values with a clear validation error', () => {
    const result = parseGenerateMessages([
      {
        role: 'assistant',
        content: 'Large replay',
        parts: [
          {
            type: 'tool-call',
            toolName: 'write_deck',
            summary: 'full deck',
            stepIndex: 0,
            toolCallId: 'call-1',
            input: { html: 'x'.repeat(MAX_PERSISTED_TOOL_VALUE_BYTES + 1) },
          },
        ],
      },
    ])
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('exceeds the 51200 byte persistence limit'),
    })
  })

  it('accepts user messages with data URL attachments', () => {
    expect(
      parseGenerateMessages([
        {
          role: 'user',
          content: 'Use this logo',
          attachments: [sampleAttachment],
        },
      ]),
    ).toEqual({
      ok: true,
      messages: [
        {
          role: 'user',
          content: 'Use this logo',
          attachments: [sampleAttachment],
        },
      ],
    })
  })

  it('does not impose a fixed attachment-count limit', () => {
    const attachments = Array.from({ length: 20 }, (_, index) => ({
      ...sampleAttachment,
      filename: `image-${index}.png`,
    }))

    const result = parseGenerateMessages([
      {
        role: 'user',
        content: 'Use all of these',
        attachments,
      },
    ])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.messages[0]?.attachments).toHaveLength(20)
    }
  })

  it('keeps attachment-only user turns', () => {
    expect(
      parseGenerateMessages([
        {
          role: 'user',
          content: '   ',
          attachments: [sampleAttachment],
        },
      ]),
    ).toEqual({
      ok: true,
      messages: [
        {
          role: 'user',
          content: '',
          attachments: [sampleAttachment],
        },
      ],
    })
  })

  it('rejects external attachment URLs without an asset reference', () => {
    expect(
      parseGenerateMessages([
        {
          role: 'user',
          content: 'hi',
          attachments: [{ ...sampleAttachment, url: 'https://example.com/logo.png' }],
        },
      ]),
    ).toEqual({
      ok: false,
      error: 'messages[0].attachments[0].url must be a data URL or Ark asset reference.',
    })
  })

  it('accepts lightweight Ark asset reference attachments', () => {
    const result = parseGenerateMessages([
      {
        role: 'user',
        content: 'Use the uploaded chart',
        attachments: [
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'chart.png',
            url: `ark-asset:${ASSET_ID}`,
            assetId: ASSET_ID,
          },
        ],
      },
    ])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.messages[0]?.attachments?.[0]?.assetId).toBe(ASSET_ID)
    }
  })

  it('infers the asset id from an Ark asset URL', () => {
    const result = parseGenerateMessages([
      {
        role: 'user',
        content: 'ref',
        attachments: [{ type: 'file', mediaType: 'image/png', url: `ark-asset:${ASSET_ID}` }],
      },
    ])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.messages[0]?.attachments?.[0]?.assetId).toBe(ASSET_ID)
    }
  })

  it('preserves valid client message ids for server-side deduplication', () => {
    expect(
      parseGenerateMessages([
        {
          id: '00000000-0000-4000-8000-000000000101',
          role: 'user',
          content: 'Make the title larger',
        },
      ]),
    ).toEqual({
      ok: true,
      messages: [
        {
          id: '00000000-0000-4000-8000-000000000101',
          role: 'user',
          content: 'Make the title larger',
        },
      ],
    })
  })

  it('ignores invalid message ids', () => {
    expect(
      parseGenerateMessages([
        {
          id: 'not-a-uuid',
          role: 'user',
          content: 'hello',
        },
      ]),
    ).toEqual({
      ok: true,
      messages: [{ role: 'user', content: 'hello' }],
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
    const messages = buildModelMessages([{ role: 'user', content: 'Investor update deck' }], '')

    expect(messages[0]?.content).toContain('Create a new complete Ark HTML slide deck')
    expect(messages[0]?.content).toContain('Investor update deck')
  })
})

describe('buildAgentModelMessages', () => {
  it('replays bounded transcript omission text instead of the prior summary', () => {
    expect(
      convertChatHistoryToModelMessages([
        {
          role: 'assistant',
          content: 'Prior summary',
          parts: [{ type: 'text', content: '[earlier steps omitted]', stepIndex: 0 }],
        },
      ]),
    ).toEqual([{ role: 'assistant', content: '[earlier steps omitted]' }])
  })

  it('replays paired tool calls and results with original ids', () => {
    const messages = convertChatHistoryToModelMessages([
      {
        role: 'assistant',
        content: 'Updated.',
        parts: [
          { type: 'text', content: 'Inspecting.', stepIndex: 0 },
          {
            type: 'tool-call',
            toolName: 'list_slides',
            summary: 'outline',
            stepIndex: 0,
            toolCallId: 'call-1',
            input: {},
          },
          {
            type: 'tool-result',
            toolName: 'list_slides',
            summary: '2 slides',
            stepIndex: 0,
            toolCallId: 'call-1',
            output: { slideCount: 2 },
            isError: false,
          },
          { type: 'text', content: 'Updated.', stepIndex: 1 },
        ],
      },
    ])
    expect(messages).toHaveLength(3)
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Inspecting.' },
        { type: 'tool-call', toolCallId: 'call-1' },
      ],
    })
    expect(messages[1]).toMatchObject({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          output: { type: 'json', value: { slideCount: 2 } },
        },
      ],
    })
    expect(messages[2]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'Updated.' }],
    })
  })

  it('falls back to assistant content for an incomplete replay turn', () => {
    expect(
      convertChatHistoryToModelMessages([
        {
          role: 'assistant',
          content: 'Prior summary',
          parts: [
            {
              type: 'tool-call',
              toolName: 'read_deck',
              summary: 'slide',
              stepIndex: 0,
              toolCallId: 'call-1',
              input: {},
            },
          ],
        },
      ]),
    ).toEqual([{ role: 'assistant', content: 'Prior summary' }])
  })

  it('does not embed full HTML in the latest user turn', () => {
    const messages = buildAgentModelMessages(
      [{ role: 'user', content: 'Make the title larger' }],
      '<html><body><section class="slide">cats</section></body></html>',
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
    )

    const content = messages[0]?.content as string
    expect(content).toContain('locked')
    expect(content).toMatch(/cannot be changed|safe patch/)
  })

  it('omits selection context when none is provided', () => {
    const messages = buildAgentModelMessages(
      [{ role: 'user', content: 'update the deck' }],
      '<html><body><section class="slide">cats</section></body></html>',
    )

    const content = messages[0]?.content as string
    expect(content).not.toContain('selected in the editor')
  })
})

describe('isReadableTextMediaType', () => {
  it('accepts text/* and application/json', () => {
    expect(isReadableTextMediaType('text/csv')).toBe(true)
    expect(isReadableTextMediaType('text/plain; charset=utf-8')).toBe(true)
    expect(isReadableTextMediaType('application/json')).toBe(true)
    expect(isReadableTextMediaType('image/png')).toBe(false)
    expect(isReadableTextMediaType('application/pdf')).toBe(false)
  })
})

describe('chatAttachmentsToModelParts', () => {
  it('emits file parts for inline image data URLs and skips asset references', () => {
    const parts = chatAttachmentsToModelParts([
      sampleAttachment,
      { type: 'file', mediaType: 'image/png', url: `ark-asset:${ASSET_ID}`, assetId: ASSET_ID },
    ])

    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ type: 'file', mediaType: 'image/png' })
  })

  it('describes browser-native images that providers may reject instead of sending bytes', () => {
    const parts = chatAttachmentsToModelParts([
      {
        type: 'file',
        mediaType: 'image/avif',
        filename: 'hero.avif',
        url: 'data:image/avif;base64,AAAA',
      },
    ])

    expect(parts).toEqual([
      {
        type: 'text',
        text: expect.stringContaining(
          'available through list_attachments for placement, but this provider may not support visual preview',
        ),
      },
    ])
  })

  it('converts CSV and plain-text data URLs into labeled text parts', () => {
    const csv = 'name,value\none,1'
    const plain = 'hello world'
    const parts = chatAttachmentsToModelParts([
      {
        type: 'file',
        mediaType: 'text/csv',
        filename: 'data.csv',
        url: `data:text/csv;base64,${Buffer.from(csv, 'utf8').toString('base64')}`,
      },
      {
        type: 'file',
        mediaType: 'text/plain',
        filename: 'notes.txt',
        url: `data:text/plain,${encodeURIComponent(plain)}`,
      },
      {
        type: 'file',
        mediaType: 'text/csv',
        filename: 'prior.csv',
        url: `ark-asset:${ASSET_ID}`,
        assetId: ASSET_ID,
      },
    ])

    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatchObject({
      type: 'text',
      text: `Attached file "data.csv" (text/csv):\n${csv}`,
    })
    expect(parts[1]).toMatchObject({
      type: 'text',
      text: `Attached file "notes.txt" (text/plain):\n${plain}`,
    })
  })

  it('truncates oversized inline text attachments', () => {
    const body = 'x'.repeat(MAX_INLINE_TEXT_ATTACHMENT_CHARS + 50)
    const parts = chatAttachmentsToModelParts([
      {
        type: 'file',
        mediaType: 'text/plain',
        filename: 'big.txt',
        url: `data:text/plain;base64,${Buffer.from(body, 'utf8').toString('base64')}`,
      },
    ])

    expect(parts).toHaveLength(1)
    expect(parts[0]?.type).toBe('text')
    const text = (parts[0] as { type: 'text'; text: string }).text
    expect(text).toContain('Attached file "big.txt" (text/plain):')
    expect(text).toContain('x'.repeat(MAX_INLINE_TEXT_ATTACHMENT_CHARS))
    expect(text).toContain(
      `[Truncated: showing first ${MAX_INLINE_TEXT_ATTACHMENT_CHARS} characters of ${body.length}.]`,
    )
    expect(text).not.toContain('x'.repeat(MAX_INLINE_TEXT_ATTACHMENT_CHARS + 1))
  })
})

describe('collectAssetIds', () => {
  it('collects unique asset ids from references and URLs', () => {
    expect(
      collectAssetIds([
        { type: 'file', mediaType: 'image/png', url: `ark-asset:${ASSET_ID}`, assetId: ASSET_ID },
        { type: 'file', mediaType: 'image/png', url: `ark-asset:${ASSET_ID}` },
        sampleAttachment,
      ]),
    ).toEqual([ASSET_ID])
  })

  it('returns an empty array for no attachments', () => {
    expect(collectAssetIds(undefined)).toEqual([])
  })
})

describe('collectAssetIdsFromMessages', () => {
  it('collects asset ids from user messages only', () => {
    expect(
      collectAssetIdsFromMessages([
        {
          role: 'user',
          content: 'first',
          attachments: [
            {
              type: 'file',
              mediaType: 'image/png',
              url: `/api/decks/deck-id/assets/${ASSET_ID}`,
              assetId: ASSET_ID,
            },
          ],
        },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'second' },
      ]),
    ).toEqual([ASSET_ID])
  })
})

describe('applyResolvedAssetAttachments', () => {
  it('replaces Ark references with resolved data URLs across user turns', () => {
    const resolved = new Map([
      [
        ASSET_ID,
        {
          type: 'file' as const,
          mediaType: 'image/png',
          url: 'data:image/png;base64,BBBB',
          assetId: ASSET_ID,
          filename: 'chart.png',
        },
      ],
    ])

    const messages = applyResolvedAssetAttachments(
      [
        {
          role: 'user',
          content: 'Use the chart',
          attachments: [
            {
              type: 'file',
              mediaType: 'image/png',
              url: `/api/decks/deck-id/assets/${ASSET_ID}`,
              assetId: ASSET_ID,
            },
          ],
        },
        { role: 'assistant', content: 'Done' },
        { role: 'user', content: 'Add another slide from the chart' },
      ],
      resolved,
    )

    expect(messages[0]?.attachments?.[0]?.url).toBe('data:image/png;base64,BBBB')
    expect(messages[2]?.attachments).toBeUndefined()
  })
})

describe('agentStepsToChatParts', () => {
  it('converts agent steps into persisted chat parts', () => {
    expect(
      agentStepsToChatParts([
        { type: 'thinking', summary: 'Plan first.', durationMs: 1500 },
        { type: 'tool-call', toolName: 'read_deck', summary: 'lines 1–100' },
        { type: 'tool-result', toolName: 'edit_deck', summary: 'Applied 1 edit(s)' },
        { type: 'text', summary: 'Done.' },
      ]),
    ).toEqual([
      { type: 'thinking', content: 'Plan first.', durationMs: 1500 },
      { type: 'tool-call', toolName: 'read_deck', summary: 'lines 1–100' },
      { type: 'tool-result', toolName: 'edit_deck', summary: 'Applied 1 edit(s)' },
      { type: 'text', content: 'Done.' },
    ])
  })
})

describe('buildAssistantMessageContent', () => {
  it('falls back to the last successful tool result summary', () => {
    expect(
      buildAssistantMessageContent(
        '',
        [{ type: 'tool-result', toolName: 'write_deck', summary: 'Deck written' }],
        false,
      ),
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
})
