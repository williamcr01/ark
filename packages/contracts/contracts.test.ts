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
import {
  assetListResponseSchema,
  uploadAssetRequestSchema,
  uploadAssetResponseSchema,
} from './assets.ts'
import { runtimeErrorInputSchema, runtimeErrorResponseSchema } from './runtime-errors.ts'
import { runtimeRegistryResponseSchema } from './runtimes.ts'
import { deckAssetProxyBlockedResponseSchema } from './deck-asset-proxy.ts'

const deckId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'
const jobId = 'a0000000-0000-4000-8000-000000000001'
const assetId = '00000000-0000-4000-8000-000000000701'

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

    expect(
      startGenerationJobRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        deckId,
        assetIds: [assetId],
      }).success,
    ).toBe(true)

    expect(
      startGenerationJobRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'make this bigger' }],
        deckId,
        editorSelection: {
          slideIndex: 2,
          slideId: 'ark-slide-1',
          elementId: 'ark-el-9',
          elementKind: 'text',
          textPreview: 'Headline',
          locked: false,
          managed: true,
        },
      }).success,
    ).toBe(true)

    expect(
      startGenerationJobRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'make this bigger' }],
        deckId,
        editorSelection: { slideIndex: 0 },
      }).success,
    ).toBe(false)

    expect(
      startGenerationJobRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'make this bigger' }],
        deckId,
        editorSelection: { slideIndex: -1, elementId: 'ark-el-9' },
      }).success,
    ).toBe(false)
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

  it('parses asset contracts', () => {
    expect(
      uploadAssetRequestSchema.safeParse({
        filename: 'logo.png',
        mediaType: 'image/png',
        data: 'data:image/png;base64,AAAA',
      }).success,
    ).toBe(true)

    expect(uploadAssetRequestSchema.safeParse({ filename: 'logo.png' }).success).toBe(false)

    const asset = {
      id: assetId,
      deckId,
      chatMessageId: null,
      filename: 'logo.png',
      mediaType: 'image/png',
      category: 'image' as const,
      byteSize: 128,
      checksum: 'abc',
      source: 'upload' as const,
      storageKind: 'local',
      url: `/api/decks/${deckId}/assets/${assetId}`,
      createdAt: '2026-01-01T00:00:00.000Z',
    }

    expect(uploadAssetResponseSchema.parse({ asset })).toBeTruthy()
    expect(assetListResponseSchema.parse({ assets: [asset] })).toBeTruthy()
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

  it('parses runtime registry and deck asset proxy contracts', () => {
    expect(
      runtimeRegistryResponseSchema.parse({
        schemaVersion: 1,
        runtimes: [
          {
            id: 'reveal.js',
            version: '5.1.0',
            runtimeMode: 'reveal',
            deprecated: false,
            previewMode: 'css-only',
            allowsDeckScripts: true,
            assets: [
              {
                path: 'reveal.js',
                kind: 'script',
                url: '/api/runtimes/reveal.js/5.1.0/reveal.js',
                sha256: 'a'.repeat(64),
                size: 1024,
              },
            ],
          },
        ],
      }),
    ).toBeTruthy()

    expect(
      deckAssetProxyBlockedResponseSchema.parse({
        error: 'External assets are blocked.',
        proxyUrl: '/api/deck-assets?url=https%3A%2F%2Fexample.com%2Flogo.png',
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
