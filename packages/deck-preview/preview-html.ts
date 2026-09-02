import {
  buildDeckBridgeRuntimeScript,
  buildDeckCssNavRuntimeScript,
  buildDeckHandshakeSentinelScript,
  buildRevealNavRuntimeScript,
} from './deck-bridge.ts'
import { EDITOR_SESSION_HANDOFF_KEY } from '@ark/editor-runtime'
import type { DeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'
import {
  detectRuntimeModeFromDocument,
  documentAllowsDeckInitScripts,
  runtimeModeAllowsDeckScripts,
  runtimeModeToBridgePreviewMode,
  type DeckRuntimeMode,
} from '@ark/runtime-registry/deck-runtime.ts'
import { generateCspNonce } from './csp-nonce.ts'
import { SLIDE_SELECTOR_CHAIN, stripHostileNavigationVectors } from './preview-slides.ts'
import {
  deckUsesChartJsAddon,
  hasApprovedRevealRuntimeInDocument,
} from '@ark/runtime-registry/deck-runtime-registry.ts'
import {
  activateInitialCssNavSlide,
  appendEditorBridgeInjection,
  appendPreviewFill,
  appendScript,
  applyPreviewNonce,
  ensureBody,
  ensureHead,
  finalizePreviewHtml,
  injectHandshakeSentinel,
  injectRuntimeCspMeta,
  stripDeckScriptsAndHandlers,
  stripInlineHandlers,
} from './preview-html-inject.ts'

export {
  absolutizeApprovedRuntimeAssetText,
  absolutizePreviewAssetReferences,
  stripPreviewScriptsAndHandlers,
} from './preview-html-inject.ts'

export type PreviewHtmlOptions = {
  parentOrigin?: string
  manifest?: Pick<DeckRuntimeManifest, 'runtimeMode' | 'usesRevealAdapter' | 'previewMode'>
  editorBridge?: boolean
  /**
   * Override the per-render CSP nonce. When omitted, a fresh nonce is generated
   * for static/reveal modes. Ignored for custom-js (keeps `'unsafe-inline'`).
   */
  nonce?: string | null
  /**
   * Generation-correlation handshake for the head sentinel and editor channel.
   * The injected sentinel removes its DOM node before deck scripts execute.
   */
  handshake?: string
  /** Which CSS-only slide to show first. Defaults to 0. */
  initialSlideIndex?: number
}

export type PreviewDocumentResult = {
  html: string
  runtimeMode: DeckRuntimeMode
  /** Nonce used for Ark-injected scripts + CSP; null for custom-js. */
  nonce: string | null
}

export type PreviewHandshakeInjectionOptions = {
  /**
   * Per-session generation-correlation handshake for the head sentinel and
   * editor channel.
   */
  handshake?: string
  parentOrigin?: string
  /** Nonce to apply to the injected handshake and any cached Ark scripts. */
  nonce?: string | null
  /**
   * Optional placeholder nonce used in cacheable pre-handshake preview HTML.
   * When provided with `nonce`, matching CSP nonce sources and nonce attributes
   * are rewritten after the cache boundary.
   */
  noncePlaceholder?: string | null
}

export function buildPreviewDocument(
  html: string,
  options: PreviewHtmlOptions = {},
): PreviewDocumentResult {
  if (!html) {
    return { html: '', runtimeMode: 'static', nonce: null }
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const mode = options.manifest?.runtimeMode ?? detectRuntimeModeFromDocument(doc)
  const chartAddon = deckUsesChartJsAddon(doc)
  const allowsDeckInitScripts = documentAllowsDeckInitScripts(doc)
  const usesRevealAdapter =
    options.manifest?.usesRevealAdapter ??
    (mode === 'reveal' && hasApprovedRevealRuntimeInDocument(doc))
  const assetOrigin = options.parentOrigin
  // Nonces neutralize javascript: URLs and slipped-past inline handlers in
  // CSS-only / reveal-adapter modes. custom-js and reveal+chart need inline scripts.
  const nonce = allowsDeckInitScripts ? null : options.nonce?.trim() || generateCspNonce()
  // Meta refresh / javascript: URLs have no legitimate use in any preview mode.
  stripHostileNavigationVectors(doc.documentElement)
  const runtimeOptions = {
    slideSelectors: SLIDE_SELECTOR_CHAIN,
    previewMode: runtimeModeToBridgePreviewMode(mode, { usesRevealAdapter }),
    parentOrigin: options.parentOrigin,
  }
  const body = ensureBody(doc)

  if (runtimeModeAllowsDeckScripts(mode)) {
    absolutizePreviewAssetReferences(doc.documentElement, assetOrigin)
    injectRuntimeCspMeta(doc, mode, { assetOrigin, nonce })
    appendPreviewFill(doc, { historyShim: true, nonce, assetOrigin })
    appendScript(
      doc,
      body,
      buildDeckBridgeRuntimeScript(runtimeOptions),
      'data-ark-preview-bridge',
      nonce,
    )
    appendEditorBridgeInjection(doc, ensureHead(doc), options, runtimeOptions, nonce)
    injectHandshakeSentinel(doc, options, nonce)

    return {
      html: finalizePreviewHtml(doc),
      runtimeMode: mode,
      nonce,
    }
  }

  if (usesRevealAdapter) {
    if (chartAddon) {
      stripInlineHandlers(doc.documentElement)
    } else {
      stripDeckScriptsAndHandlers(doc, { preserveApprovedRuntimeScripts: true })
    }
    absolutizePreviewAssetReferences(doc.documentElement, assetOrigin)
    injectRuntimeCspMeta(doc, mode, { assetOrigin, nonce })
    appendPreviewFill(doc, { historyShim: true, nonce, assetOrigin })
    appendScript(
      doc,
      body,
      buildRevealNavRuntimeScript(runtimeOptions),
      'data-ark-preview-reveal',
      nonce,
    )
    appendEditorBridgeInjection(doc, ensureHead(doc), options, runtimeOptions, nonce)
    injectHandshakeSentinel(doc, options, nonce)

    return {
      html: finalizePreviewHtml(doc),
      runtimeMode: mode,
      nonce,
    }
  }

  stripDeckScriptsAndHandlers(doc, {
    preserveApprovedRuntimeScripts: mode === 'reveal',
  })
  absolutizePreviewAssetReferences(doc.documentElement, assetOrigin)
  injectRuntimeCspMeta(doc, mode, { assetOrigin, nonce })
  appendPreviewFill(doc, { nonce, assetOrigin })
  activateInitialCssNavSlide(doc, options.initialSlideIndex)
  appendScript(
    doc,
    body,
    buildDeckCssNavRuntimeScript(runtimeOptions),
    'data-ark-preview-nav',
    nonce,
  )
  appendEditorBridgeInjection(doc, ensureHead(doc), options, runtimeOptions, nonce)
  injectHandshakeSentinel(doc, options, nonce)

  return {
    html: finalizePreviewHtml(doc),
    runtimeMode: mode,
    nonce,
  }
}

export function buildPreviewHtml(html: string, options: PreviewHtmlOptions = {}) {
  return buildPreviewDocument(html, options).html
}

/**
 * Inject the per-session handshake into an already-sanitized preview document.
 * This is intentionally separate from {@link buildPreviewDocument} so callers
 * can cache the hostile-stripped pre-handshake base and add session material
 * after the cache boundary.
 */
export function injectPreviewHandshake(
  html: string,
  options: PreviewHandshakeInjectionOptions = {},
): string {
  if (!html) {
    return html
  }

  const fastPath = tryInjectPreviewHandshakeFast(html, options)

  if (fastPath !== null) {
    return fastPath
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const nonce = options.nonce?.trim() || null

  applyPreviewNonce(doc, {
    nonce,
    noncePlaceholder: options.noncePlaceholder,
  })
  injectHandshakeSentinel(
    doc,
    {
      parentOrigin: options.parentOrigin,
      handshake: options.handshake,
    },
    nonce,
  )

  // Same post-serialize hostile strip as buildPreviewDocument so a second
  // parse/serialize cannot resurrect NUL-byte meta refresh (or similar).
  return finalizePreviewHtml(doc)
}

/**
 * Cache-hit fast path: rewrite the unique nonce placeholder and inject the
 * handshake sentinel without a full DOM re-parse. Falls back to null when the
 * document shape is unfamiliar.
 */
function tryInjectPreviewHandshakeFast(
  html: string,
  options: PreviewHandshakeInjectionOptions,
): string | null {
  const handshake = options.handshake?.trim()
  const nonce = options.nonce?.trim()
  const placeholder = options.noncePlaceholder?.trim()

  if (!handshake || !nonce || !placeholder || nonce === placeholder) {
    return null
  }

  if (!html.includes(placeholder)) {
    return null
  }

  // Placeholder is a unique cache token (`ArkPreviewCacheNoncePlaceholder`);
  // global replace rewrites both attribute nonces and CSP `'nonce-…'` sources.
  let next = html.replaceAll(placeholder, nonce)

  // Only treat an Ark-injected handshake <script> as already present. Deck
  // authored attributes like data-ark-preview-handshake must not suppress
  // sentinel injection.
  if (/<script\b[^>]*\bdata-ark-preview-handshake\b/i.test(next)) {
    return next
  }

  const scriptBody = buildDeckHandshakeSentinelScript(
    handshake,
    options.parentOrigin,
    /<script\b[^>]*\bdata-ark-preview-editor\b/i.test(next)
      ? EDITOR_SESSION_HANDOFF_KEY
      : undefined,
  )
  const scriptTag = `<script data-ark-preview-handshake="" nonce="${nonce}">${scriptBody}</script>`
  const headOpen = next.match(/<head([^>]*)>/i)

  if (!headOpen || headOpen.index === undefined) {
    return null
  }

  const insertAt = headOpen.index + headOpen[0].length
  next = `${next.slice(0, insertAt)}${scriptTag}${next.slice(insertAt)}`
  return next
}
