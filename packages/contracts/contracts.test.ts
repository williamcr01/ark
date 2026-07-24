import { describe, expect, it } from 'vitest'

import { apiErrorPayloadSchema, parseRequestBody, simpleErrorResponseSchema } from './common.ts'
import {
  createDeckRequestSchema,
  deckListResponseSchema,
  deckResponseSchema,
  deckVersionDiffSchema,
  deckManualVersionProvenanceSchema,
  deckVersionProvenanceSchema,
  deckVersionSummarySchema,
  normalizeDeckVersionDiff,
  normalizeDeckVersionProvenance,
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
            supportsReasoning: true,
          },
        ],
        warnings: [],
      }),
    ).toMatchObject({ defaultModel: 'openai:gpt-5.6-luna' })
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
    expect(deckThumbnailsQuerySchema.parse({ versionId: deckId })).toEqual({
      versionId: deckId,
      waitMs: 0,
    })
    expect(deckThumbnailsQuerySchema.parse({ versionId: deckId, waitMs: '2500' })).toEqual({
      versionId: deckId,
      waitMs: 2500,
    })
    expect(deckThumbnailsQuerySchema.safeParse({ versionId: deckId, waitMs: '6000' }).success).toBe(
      false,
    )
    expect(deckThumbnailsQuerySchema.safeParse({ versionId: 'bad' }).success).toBe(false)
    expect(
      deckThumbnailImageParamsSchema.parse({
        id: deckId,
        versionId: deckId,
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
            url: `/api/decks/${deckId}/thumbnails/${deckId}/0.png?hash=${'a'.repeat(64)}`,
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
        versionId: null,
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

  it('parses deck version provenance and diff metadata', () => {
    const provenance = deckVersionProvenanceSchema.parse({
      operations: ['replace_text', 'undo'],
      slideIndexes: [0],
      elementIds: ['ark-el-1'],
      jobId: 'a0000000-0000-4000-8000-000000000001',
      stepCount: 3,
      toolCalls: [{ toolName: 'patch_deck', summary: 'rename slide 0' }],
      restoredVersionId: deckId,
      restoredVersionNumber: 2,
      runtimeManifestHash: 'abc123',
    })

    const diff = deckVersionDiffSchema.parse({
      kind: 'structural',
      slideCountBefore: 2,
      slideCountAfter: 3,
      addedSlides: [{ index: 2, title: 'Closing' }],
      changedSlides: [{ index: 0, contentChanged: true, title: 'Opening' }],
      titleChanged: true,
      assetsAdded: ['data:image/png;base64,abc'],
    })

    expect(
      deckVersionSummarySchema.parse({
        id: deckId,
        deckId,
        versionNumber: 2,
        title: 'Deck',
        source: 'manual',
        summary: 'Edited slide',
        validationStatus: 'valid',
        runtimeManifest: null,
        modelProvider: 'openai',
        modelName: 'gpt-4.1-mini',
        provenance,
        diff,
        createdAt: '2026-01-01T00:00:00.000Z',
        isActive: true,
      }),
    ).toMatchObject({
      modelName: 'gpt-4.1-mini',
      provenance: { operations: ['replace_text', 'undo'] },
      diff: { kind: 'structural', slideCountAfter: 3 },
    })
  })

  it('accepts legacy version summaries without provenance fields', () => {
    expect(
      deckVersionSummarySchema.parse({
        id: deckId,
        deckId,
        versionNumber: 1,
        title: 'Deck',
        source: 'upload',
        summary: null,
        validationStatus: 'valid',
        runtimeManifest: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        isActive: true,
      }),
    ).toMatchObject({ versionNumber: 1 })
  })

  it('rejects oversized provenance arrays', () => {
    expect(
      deckVersionProvenanceSchema.safeParse({
        operations: Array.from({ length: 41 }, () => 'undo'),
      }).success,
    ).toBe(false)
    expect(
      deckManualVersionProvenanceSchema.safeParse({
        operations: Array.from({ length: 41 }, () => 'undo'),
      }).success,
    ).toBe(false)
    expect(
      deckManualVersionProvenanceSchema.safeParse({
        operations: ['undo'],
        jobId: 'forged',
      }),
    ).toMatchObject({
      success: true,
      data: { operations: ['undo'] },
    })
    expect(
      deckVersionDiffSchema.safeParse({
        kind: 'structural',
        addedSlides: Array.from({ length: 101 }, (_, index) => ({
          index,
          title: `Slide ${index}`,
        })),
      }).success,
    ).toBe(false)
  })

  it('normalizes invalid provenance and diff payloads to null', () => {
    expect(normalizeDeckVersionProvenance({ operations: ['not-an-op'] })).toBeNull()
    expect(normalizeDeckVersionDiff({ kind: 'invalid' })).toBeNull()
    expect(normalizeDeckVersionProvenance(null)).toBeNull()
  })

  it('soft-normalizes oversized asset URLs instead of dropping the whole diff', () => {
    const huge = `data:image/png;base64,${'A'.repeat(5000)}`
    const normalized = normalizeDeckVersionDiff({
      kind: 'structural',
      slideCountBefore: 1,
      slideCountAfter: 1,
      assetsAdded: [huge],
      addedSlides: [{ index: 0, title: 'T'.repeat(500) }],
    })

    expect(normalized?.kind).toBe('structural')
    expect(normalized?.assetsAdded?.[0]).toMatch(/^data-asset:/)
    expect(normalized?.assetsAdded?.[0]?.length).toBeLessThanOrEqual(2048)
    expect(normalized?.addedSlides?.[0]?.title.length).toBeLessThanOrEqual(200)
    expect(JSON.stringify(normalized)).not.toContain('AAAA')
  })

  it('strips client-writable diff and model fields from create requests', () => {
    const parsed = parseRequestBody(createDeckRequestSchema, {
      html: '<!DOCTYPE html><html><body><section class="slide"></section></body></html>',
      source: 'agent',
      modelProvider: 'openai',
      modelName: 'gpt-forged',
      diff: { kind: 'coarse', htmlBytesBefore: 1, htmlBytesAfter: 2 },
      provenance: { operations: ['undo'], jobId: 'forged' },
    })

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.data).toEqual({
        html: '<!DOCTYPE html><html><body><section class="slide"></section></body></html>',
        source: 'agent',
        provenance: { operations: ['undo'] },
      })
      expect('diff' in parsed.data).toBe(false)
      expect('modelProvider' in parsed.data).toBe(false)
      expect('modelName' in parsed.data).toBe(false)
    }
  })
})
