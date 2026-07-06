import { describe, expect, it } from 'vitest'

import { apiErrorPayloadSchema, parseRequestBody, simpleErrorResponseSchema } from './common.ts'
import {
  createDeckRequestSchema,
  deckListResponseSchema,
  deckResponseSchema,
  renameDeckRequestSchema,
  rollbackDeckRequestSchema,
} from './decks.ts'
import { healthResponseSchema, modelsResponseSchema } from './health.ts'
import { generationJobResponseSchema, startGenerationJobRequestSchema } from './generation-jobs.ts'
import { createPreviewSessionRequestSchema, previewSessionResponseSchema } from './preview.ts'
import { appendChatMessageRequestSchema, deckChatResponseSchema } from './chat.ts'
import { runtimeErrorInputSchema, runtimeErrorResponseSchema } from './runtime-errors.ts'

const deckId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'
const jobId = 'a0000000-0000-4000-8000-000000000001'

describe('shared API contracts', () => {
  it('parses health and models responses', () => {
    expect(
      healthResponseSchema.parse({
        ok: true,
        model: 'openai:gpt-4o-mini',
        apiKey: { configured: true },
        providers: {
          openai: { configured: true },
          anthropic: { configured: false },
          google: { configured: false },
        },
        preview: {
          sandboxOrigin: 'http://localhost:5174',
          appOrigin: 'http://localhost:5173',
        },
      }),
    ).toMatchObject({ ok: true })
  })

  it('parses models response', () => {
    expect(
      modelsResponseSchema.parse({
        defaultModel: 'openai:gpt-4o-mini',
        models: [
          {
            id: 'openai:gpt-4o-mini',
            provider: 'openai',
            modelId: 'gpt-4o-mini',
            available: true,
          },
        ],
        warnings: [],
      }),
    ).toMatchObject({ defaultModel: 'openai:gpt-4o-mini' })
  })

  it('rejects invalid deck create requests', () => {
    const parsed = parseRequestBody(createDeckRequestSchema, { html: '   ' })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toContain('HTML')
    }
  })

  it('parses deck list and deck responses', () => {
    const deck = {
      id: deckId,
      html: '<!DOCTYPE html><html><body></body></html>',
      title: 'Deck',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    expect(deckResponseSchema.parse({ deck })).toEqual({ deck })
    expect(
      deckListResponseSchema.parse({
        decks: [
          {
            id: deck.id,
            title: deck.title,
            createdAt: deck.createdAt,
            updatedAt: deck.updatedAt,
          },
        ],
      }),
    ).toEqual({
      decks: [
        {
          id: deck.id,
          title: deck.title,
          createdAt: deck.createdAt,
          updatedAt: deck.updatedAt,
        },
      ],
    })
  })

  it('validates rename and rollback requests', () => {
    expect(renameDeckRequestSchema.safeParse({ title: 'New title' }).success).toBe(true)
    expect(renameDeckRequestSchema.safeParse({}).success).toBe(false)
    expect(rollbackDeckRequestSchema.safeParse({ versionId: deckId }).success).toBe(true)
  })

  it('parses generation job wire responses', () => {
    expect(
      generationJobResponseSchema.parse({
        job: {
          id: jobId,
          deckId,
          baseVersionId: null,
          editingExistingDeck: false,
          status: 'queued',
          model: 'openai:gpt-4o-mini',
          provider: 'openai',
          progress: { steps: [], stepCount: 0 },
          result: null,
          error: null,
          retryOfJobId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          startedAt: null,
          completedAt: null,
        },
      }),
    ).toBeTruthy()
  })

  it('parses start generation job requests', () => {
    expect(
      startGenerationJobRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        deckId,
      }).success,
    ).toBe(true)
  })

  it('parses preview session contracts', () => {
    expect(createPreviewSessionRequestSchema.safeParse({ html: '<html></html>' }).success).toBe(
      true,
    )
    expect(createPreviewSessionRequestSchema.safeParse({ html: '   ' }).success).toBe(false)
    expect(
      previewSessionResponseSchema.parse({
        token: 'abc',
        expiresAt: Date.now(),
        sandboxOrigin: 'http://localhost:5174',
        renderUrl: 'http://localhost:5174/render/abc',
      }),
    ).toBeTruthy()
  })

  it('parses chat contracts', () => {
    expect(
      appendChatMessageRequestSchema.safeParse({
        role: 'user',
        content: 'Hello',
      }).success,
    ).toBe(true)

    expect(
      deckChatResponseSchema.parse({
        thread: null,
        messages: [],
        hasMore: false,
      }),
    ).toBeTruthy()
  })

  it('parses runtime error contracts', () => {
    expect(runtimeErrorInputSchema.safeParse({ message: 'boom' }).success).toBe(true)
    expect(
      runtimeErrorResponseSchema.parse({
        id: jobId,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBeTruthy()
  })

  it('parses consistent API error payloads', () => {
    expect(
      apiErrorPayloadSchema.parse({
        error: 'Missing key',
        code: 'missing_api_key',
      }),
    ).toEqual({
      error: 'Missing key',
      code: 'missing_api_key',
    })

    expect(simpleErrorResponseSchema.parse({ error: 'Bad request' })).toEqual({
      error: 'Bad request',
    })
  })
})
