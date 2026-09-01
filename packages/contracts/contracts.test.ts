import { describe, expect, it } from 'vitest'

import { apiErrorPayloadSchema, parseRequestBody, simpleErrorResponseSchema } from './common.ts'
import {
  createDeckRequestSchema,
  deckListResponseSchema,
  deckResponseSchema,
  importPptxRequestSchema,
  importPptxResponseSchema,
  renameDeckRequestSchema,
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
import {
  deckThumbnailImageParamsSchema,
  deckThumbnailImageQuerySchema,
  deckThumbnailsQuerySchema,
  deckThumbnailsResponseSchema,
} from './thumbnails.ts'

const deckId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'
const jobId = 'a0000000-0000-4000-8000-000000000001'
const assetId = '00000000-0000-4000-8000-000000000701'

describe('shared API contracts', () => {
  it('parses health and models responses', () => {
    expect(
      healthResponseSchema.parse({
        ok: true,
        model: 'openai:gpt-5.6-luna',
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
        defaultModel: 'openai:gpt-5.6-luna',
        models: [
          {
            id: 'openai:gpt-5.6-luna',
            provider: 'openai',
            modelId: 'gpt-5.6-luna',
            name: 'GPT-5.6 Luna',
            available: true,
            reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
            defaultReasoningEffort: 'medium',
            supportsAttachments: true,
          },
        ],
        warnings: [],
      }),
    ).toMatchObject({ defaultModel: 'openai:gpt-5.6-luna' })
  })

  it('requires a path or bytes for PowerPoint import', () => {
    expect(parseRequestBody(importPptxRequestSchema, { filename: 'deck.pptx' })).toMatchObject({
      ok: false,
    })
    expect(
      parseRequestBody(importPptxRequestSchema, { filename: 'deck.pptx', bytes: 'AAAA' }),
    ).toMatchObject({ ok: true })
    expect(parseRequestBody(importPptxRequestSchema, { path: '/tmp/deck.pptx' })).toMatchObject({
      ok: true,
    })
  })

  it('requires warnings on PowerPoint import responses', () => {
    const deck = {
      id: deckId,
      html: '<html></html>',
      title: 'Deck',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      documentRevision: 1,
      origin: 'authored' as const,
      filePath: '/tmp/Deck.ark',
    }
    const validation = {
      valid: true,
      slideCount: 1,
      scripts: [],
      forms: 0,
      iframes: 0,
      externalUrls: [],
      malformedSlides: [],
      runtimeMarkers: {},
      issues: [],
    }
    const base = { deck, validation, runtimeManifest: null }
    expect(importPptxResponseSchema.safeParse(base).success).toBe(false)
    expect(
      importPptxResponseSchema.safeParse({
        ...base,
        warnings: ['Slide 1 has decoration that was flattened to a picture.'],
      }).success,
    ).toBe(true)
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
      documentRevision: 1,
      origin: 'authored' as const,
      filePath: '/tmp/Deck.ark',
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
            documentRevision: deck.documentRevision,
            filePath: deck.filePath,
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
          documentRevision: deck.documentRevision,
          filePath: deck.filePath,
        },
      ],
    })
  })

  it('validates rename requests', () => {
    expect(renameDeckRequestSchema.safeParse({ title: 'New title' }).success).toBe(true)
    expect(renameDeckRequestSchema.safeParse({}).success).toBe(false)
  })

  it('parses generation job wire responses', () => {
    expect(
      generationJobResponseSchema.parse({
        job: {
          id: jobId,
          deckId,
          baseDocumentRevision: null,
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
        reasoningEffort: 'high',
      }).success,
    ).toBe(true)

    expect(
      startGenerationJobRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        deckId,
        reasoningEffort: 'max',
      }).success,
    ).toBe(true)

    expect(
      startGenerationJobRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        deckId,
        reasoningEffort: 'minimal',
      }).success,
    ).toBe(true)

    expect(
      startGenerationJobRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        deckId,
        reasoningEffort: 'extra-high',
      }).success,
    ).toBe(false)

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
        messages: [{ role: 'user', content: 'update these slides' }],
        deckId,
        slideContexts: [
          { slideIndex: 0, title: 'Title' },
          { slideIndex: 2, slideId: 'ark-slide-3', title: 'Market' },
        ],
      }).success,
    ).toBe(true)

    expect(
      startGenerationJobRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'update these slides' }],
        deckId,
        slideContexts: [{ slideIndex: -1 }],
      }).success,
    ).toBe(false)

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
        handshake: 'handshake-abc',
        expiresAt: Date.now(),
        sandboxOrigin: 'http://localhost:5174',
        renderUrl: 'http://localhost:5174/render/abc',
      }),
    ).toBeTruthy()
  })

  it('parses thumbnail contracts', () => {
    expect(deckThumbnailsQuerySchema.parse({ documentRevision: '1' })).toEqual({
      documentRevision: 1,
      waitMs: 0,
    })
    expect(deckThumbnailsQuerySchema.parse({ documentRevision: '2', waitMs: '2500' })).toEqual({
      documentRevision: 2,
      waitMs: 2500,
    })
    expect(
      deckThumbnailsQuerySchema.safeParse({ documentRevision: '2', waitMs: '6000' }).success,
    ).toBe(false)
    expect(deckThumbnailsQuerySchema.safeParse({ documentRevision: 'bad' }).success).toBe(false)
    expect(
      deckThumbnailImageParamsSchema.parse({
        id: deckId,
        documentRevision: 2,
        slideFile: '0.png',
      }),
    ).toMatchObject({ slideFile: '0.png' })
    expect(
      deckThumbnailImageQuerySchema.parse({
        hash: 'a'.repeat(64),
      }),
    ).toMatchObject({ hash: 'a'.repeat(64) })
    expect(deckThumbnailImageQuerySchema.safeParse({ hash: 'abcdef01' }).success).toBe(false)

    expect(
      deckThumbnailsResponseSchema.parse({
        status: 'ready',
        slides: [
          {
            index: 0,
            url: `/api/decks/${deckId}/thumbnails/2/0.png?hash=${'a'.repeat(64)}`,
          },
        ],
        width: 480,
        height: 270,
      }),
    ).toMatchObject({ status: 'ready' })

    expect(
      deckThumbnailsResponseSchema.parse({
        status: 'failed',
        slides: [],
        error: 'Timed out waiting for deck ready during thumbnail render.',
      }),
    ).toMatchObject({ status: 'failed' })
  })

  it('parses chat contracts', () => {
    expect(
      appendChatMessageRequestSchema.safeParse({
        role: 'user',
        content: 'Hello',
      }).success,
    ).toBe(true)

    expect(
      appendChatMessageRequestSchema.safeParse({
        role: 'user',
        content: 'Update this',
        context: {
          slideContexts: [{ slideIndex: 2, title: 'Market' }],
          editorSelection: {
            slideIndex: 2,
            elementId: 'ark-el-9',
            elementKind: 'text',
          },
        },
      }).success,
    ).toBe(true)

    expect(
      appendChatMessageRequestSchema.safeParse({
        role: 'assistant',
        content: 'Done',
        context: { slideContexts: [{ slideIndex: 0 }] },
      }).success,
    ).toBe(false)

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
    const parsed = runtimeErrorInputSchema.parse({
      message: 'boom',
      html: '<script>secret()</script>',
      repairContext: {
        errorSummary: 'boom',
        affectedSlideIndex: 0,
        runtime: {
          mode: 'plain',
          previewMode: 'full-js',
          approvedRuntime: null,
        },
        validation: {
          status: 'valid',
          errors: 0,
          warnings: 0,
        },
        relatedJobId: null,
        documentRevision: null,
        html: '<main>deck contents</main>',
      },
    })
    expect(parsed).not.toHaveProperty('html')
    expect(parsed.repairContext).not.toHaveProperty('html')
    expect(
      runtimeErrorInputSchema.safeParse({
        ...parsed,
        repairContext: {
          ...parsed.repairContext,
          errorSummary: 'x'.repeat(501),
        },
      }).success,
    ).toBe(false)
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

    expect(
      apiErrorPayloadSchema.parse({
        error: 'Legacy .ppt files are not supported.',
        code: 'pptx_legacy',
      }),
    ).toMatchObject({ code: 'pptx_legacy' })

    expect(simpleErrorResponseSchema.parse({ error: 'Bad request' })).toEqual({
      error: 'Bad request',
    })
  })

  it('rejects removed version metadata in create requests', () => {
    const parsed = parseRequestBody(createDeckRequestSchema, {
      html: '<!DOCTYPE html><html><body><section class="slide"></section></body></html>',
      source: 'agent',
    })

    expect(parsed.ok).toBe(false)
  })
})
