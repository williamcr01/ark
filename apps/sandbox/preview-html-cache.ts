import { createHash } from 'node:crypto'

import { type DeckRuntimeMode } from '@ark/runtime-registry/deck-runtime.ts'

export const PREVIEW_HTML_CACHE_PIPELINE_VERSION = 'pre-handshake-preview-html-v1'
export const PREVIEW_HTML_CACHE_NONCE_PLACEHOLDER = 'ArkPreviewCacheNoncePlaceholder'

export type PreviewHtmlCacheKeyParts = {
  html: string
  parentOrigin: string
  runtimeMode: DeckRuntimeMode
  /** Discriminate reveal-adapter vs css-nav reveal transforms for the same HTML. */
  usesRevealAdapter: boolean
  editorBridge: boolean
  pipelineVersion?: string
}

export type CachedPreviewHtmlBase = {
  html: string
  runtimeMode: DeckRuntimeMode
  noncePlaceholder: string | null
  key: string
  createdAt: number
  expiresAt: number
}

export type PreviewHtmlCacheStats = {
  size: number
  maxEntries: number
  maxEntryBytes: number
  ttlMs: number
}

export type PreviewHtmlCacheOptions = {
  ttlMs?: number
  maxEntries?: number
  /** Skip caching entries whose sanitized HTML exceeds this byte length. */
  maxEntryBytes?: number
  now?: () => number
}

const DEFAULT_TTL_MS = 5 * 60 * 1000
const DEFAULT_MAX_ENTRIES = 128
const DEFAULT_MAX_ENTRY_BYTES = 2 * 1024 * 1024

export function hashPreviewHtml(html: string) {
  return createHash('sha256').update(html).digest('hex')
}

export function createPreviewHtmlCacheKey(parts: PreviewHtmlCacheKeyParts) {
  const pipelineVersion = parts.pipelineVersion ?? PREVIEW_HTML_CACHE_PIPELINE_VERSION
  const contentHash = hashPreviewHtml(parts.html)

  return [
    `pipeline=${pipelineVersion}`,
    `sha256=${contentHash}`,
    `origin=${parts.parentOrigin}`,
    `runtime=${parts.runtimeMode}`,
    `revealAdapter=${parts.usesRevealAdapter ? '1' : '0'}`,
    `editor=${parts.editorBridge ? '1' : '0'}`,
  ].join('|')
}

export class PreviewHtmlCache {
  readonly ttlMs: number
  readonly maxEntries: number
  readonly maxEntryBytes: number

  private readonly entries = new Map<string, CachedPreviewHtmlBase>()
  private readonly now: () => number

  constructor(options: PreviewHtmlCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.maxEntryBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES
    this.now = options.now ?? Date.now
  }

  get(key: string) {
    this.purgeExpired()

    const entry = this.entries.get(key)

    if (!entry) {
      return null
    }

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return null
    }

    // Refresh insertion order so Map iteration evicts the least-recently used.
    this.entries.delete(key)
    this.entries.set(key, entry)

    return entry
  }

  set(
    key: string,
    value: Pick<CachedPreviewHtmlBase, 'html' | 'runtimeMode' | 'noncePlaceholder'>,
  ) {
    const htmlBytes = Buffer.byteLength(value.html, 'utf8')

    if (htmlBytes > this.maxEntryBytes) {
      return null
    }

    const now = this.now()
    const entry: CachedPreviewHtmlBase = {
      ...value,
      key,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    }

    this.entries.delete(key)
    this.entries.set(key, entry)
    this.evictOverflow()

    return entry
  }

  clear() {
    this.entries.clear()
  }

  stats(): PreviewHtmlCacheStats {
    this.purgeExpired()

    return {
      size: this.entries.size,
      maxEntries: this.maxEntries,
      maxEntryBytes: this.maxEntryBytes,
      ttlMs: this.ttlMs,
    }
  }

  private purgeExpired() {
    const now = this.now()

    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key)
      }
    }
  }

  private evictOverflow() {
    this.purgeExpired()

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value

      if (typeof oldestKey !== 'string') {
        return
      }

      this.entries.delete(oldestKey)
    }
  }
}

export function createPreviewHtmlCache(options: PreviewHtmlCacheOptions = {}) {
  return new PreviewHtmlCache(options)
}

export const defaultPreviewHtmlCache = createPreviewHtmlCache()
