import { describe, expect, it } from 'vitest'

import { exampleDeckThemes } from '@ark/deck/document/theme.ts'

import {
  collectAssetIds,
  isReadableTextMediaType,
  MAX_INLINE_TEXT_ATTACHMENT_CHARS,
} from './attachments.ts'
import { MAX_EDITOR_SELECTIONS, normalizeEditorSelectionFields } from './context.ts'
import {
  applyResolvedAssetAttachments,
  chatAttachmentsToModelParts,
  collectAssetIdsFromMessages,
} from './model-messages.ts'
import {
  agentStepsToChatParts,
  buildAssistantMessageContent,
  parseGenerateMessages,
} from './api-projection.ts'
import { MAX_PERSISTED_TOOL_VALUE_BYTES } from './messages.ts'
import { convertChatHistoryToModelMessages } from './chat-context.ts'

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

  it('persists a structured theme selection on the user turn', () => {
    const theme = exampleDeckThemes().midnight
    const result = parseGenerateMessages([
      {
        role: 'user',
        content:
          'Pick a visual direction: theme choice:\n- Theme: Midnight Editorial (id: midnight)',
        context: {
          themeSelection: {
            themeId: 'midnight',
            name: 'Midnight Editorial',
            fonts: theme.fonts,
            theme,
          },
        },
      },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.messages[0]?.context?.themeSelection?.theme.signature).toBe(theme.signature)
    }
  })

  it('round-trips singular editorSelection as both singular and array', () => {
    const result = parseGenerateMessages([
      {
        role: 'user',
        content: 'make this bigger',
        context: {
          editorSelection: {
            slideIndex: 2,
            elementId: 'ark-el-9',
            elementKind: 'text',
            textPreview: 'Headline',
          },
        },
      },
    ])
    expect(result).toEqual({
      ok: true,
      messages: [
        {
          role: 'user',
          content: 'make this bigger',
          context: {
            editorSelection: {
              slideIndex: 2,
              elementId: 'ark-el-9',
              elementKind: 'text',
              textPreview: 'Headline',
            },
            editorSelections: [
              {
                slideIndex: 2,
                elementId: 'ark-el-9',
                elementKind: 'text',
                textPreview: 'Headline',
              },
            ],
          },
        },
      ],
    })
  })

  it('persists the full editorSelections set with the primary as singular', () => {
    const result = parseGenerateMessages([
      {
        role: 'user',
        content: 'align these',
        context: {
          editorSelection: { slideIndex: 1, elementId: 'ark-el-primary' },
          editorSelections: [
            { slideIndex: 1, elementId: 'ark-el-a', elementKind: 'text' },
            { slideIndex: 1, elementId: 'ark-el-primary' },
            { slideIndex: 1, elementId: 'ark-el-c' },
          ],
        },
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.messages[0]?.context?.editorSelection?.elementId).toBe('ark-el-primary')
    expect(result.messages[0]?.context?.editorSelections?.map((item) => item.elementId)).toEqual([
      'ark-el-a',
      'ark-el-primary',
      'ark-el-c',
    ])
  })

  it('drops mixed-slide extras from editorSelections without failing the job', () => {
    const result = parseGenerateMessages([
      {
        role: 'user',
        content: 'align these',
        context: {
          editorSelection: { slideIndex: 0, elementId: 'ark-el-a' },
          editorSelections: [
            { slideIndex: 0, elementId: 'ark-el-a' },
            { slideIndex: 2, elementId: 'ark-el-other-slide' },
            { slideIndex: 0, elementId: 'ark-el-b' },
          ],
        },
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.messages[0]?.context?.editorSelections?.map((item) => item.elementId)).toEqual([
      'ark-el-a',
      'ark-el-b',
    ])
  })

  it('rejects editorSelections above the 32-element cap', () => {
    expect(
      parseGenerateMessages([
        {
          role: 'user',
          content: 'align these',
          context: {
            editorSelections: Array.from({ length: MAX_EDITOR_SELECTIONS + 1 }, (_, index) => ({
              slideIndex: 0,
              elementId: `ark-el-${index}`,
            })),
          },
        },
      ]),
    ).toEqual({
      ok: false,
      error: `messages[0].context.editorSelections exceeds the ${MAX_EDITOR_SELECTIONS} element limit.`,
    })
  })

  it('accepts editorSelections at the 32-element cap with the last item as primary', () => {
    const selections = Array.from({ length: MAX_EDITOR_SELECTIONS }, (_, index) => ({
      slideIndex: 0,
      elementId: `ark-el-${index}`,
    }))
    const result = parseGenerateMessages([
      {
        role: 'user',
        content: 'align these',
        context: {
          editorSelection: selections[MAX_EDITOR_SELECTIONS - 1],
          editorSelections: selections,
        },
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.messages[0]?.context?.editorSelection?.elementId).toBe(
      `ark-el-${MAX_EDITOR_SELECTIONS - 1}`,
    )
    expect(result.messages[0]?.context?.editorSelections?.map((item) => item.elementId)).toEqual(
      selections.map((item) => item.elementId),
    )
  })

  it('keeps a capped same-slide set instead of swapping in a 33rd primary', () => {
    const editorSelections = Array.from({ length: MAX_EDITOR_SELECTIONS }, (_, index) => ({
      slideIndex: 0,
      elementId: `ark-el-${index}`,
    }))
    const result = parseGenerateMessages([
      {
        role: 'user',
        content: 'align these',
        context: {
          editorSelection: { slideIndex: 0, elementId: 'ark-el-extra' },
          editorSelections,
        },
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.messages[0]?.context?.editorSelections?.map((item) => item.elementId)).toEqual(
      editorSelections.map((item) => item.elementId),
    )
    expect(
      result.messages[0]?.context?.editorSelections?.some(
        (item) => item.elementId === 'ark-el-extra',
      ),
    ).toBe(false)
  })
})

describe('convertChatHistoryToModelMessages', () => {
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

describe('normalizeEditorSelectionFields', () => {
  it('populates both fields when only the singular selection is provided', () => {
    expect(
      normalizeEditorSelectionFields({
        editorSelection: { slideIndex: 2, elementId: 'ark-el-9' },
      }),
    ).toEqual({
      editorSelection: { slideIndex: 2, elementId: 'ark-el-9' },
      editorSelections: [{ slideIndex: 2, elementId: 'ark-el-9' }],
    })
  })

  it('uses the last remaining same-slide item as primary when singular is omitted', () => {
    const normalized = normalizeEditorSelectionFields({
      editorSelections: [
        { slideIndex: 1, elementId: 'ark-el-a' },
        { slideIndex: 1, elementId: 'ark-el-b' },
      ],
    })
    expect(normalized.editorSelection?.elementId).toBe('ark-el-b')
    expect(normalized.editorSelections?.map((item) => item.elementId)).toEqual([
      'ark-el-a',
      'ark-el-b',
    ])
  })

  it('keeps the array when the primary is on a different slide', () => {
    const normalized = normalizeEditorSelectionFields({
      editorSelection: { slideIndex: 5, elementId: 'ark-el-stale' },
      editorSelections: [
        { slideIndex: 1, elementId: 'ark-el-a' },
        { slideIndex: 1, elementId: 'ark-el-b' },
      ],
    })
    expect(normalized.editorSelections?.map((item) => item.elementId)).toEqual([
      'ark-el-a',
      'ark-el-b',
    ])
    expect(normalized.editorSelection?.elementId).toBe('ark-el-b')
  })

  it('does not pop a capped set to make room for a distinct 33rd primary', () => {
    const editorSelections = Array.from({ length: MAX_EDITOR_SELECTIONS }, (_, index) => ({
      slideIndex: 0,
      elementId: `ark-el-${index}`,
    }))
    const normalized = normalizeEditorSelectionFields({
      editorSelection: { slideIndex: 0, elementId: 'ark-el-extra' },
      editorSelections,
    })
    expect(normalized.editorSelections?.map((item) => item.elementId)).toEqual(
      editorSelections.map((item) => item.elementId),
    )
    expect(normalized.editorSelections?.some((item) => item.elementId === 'ark-el-extra')).toBe(
      false,
    )
  })
})
