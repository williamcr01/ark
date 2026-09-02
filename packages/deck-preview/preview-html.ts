import {
  buildDeckBridgeRuntimeScript,
  buildDeckCssNavRuntimeScript,
  buildDeckHandshakeSentinelScript,
  buildRevealNavRuntimeScript,
} from './deck-bridge.ts'
import { buildDeckEditorBridgeRuntimeScript, EDITOR_SESSION_HANDOFF_KEY } from '@ark/editor-runtime'
import type { DeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'
import {
  detectRuntimeModeFromDocument,
  documentAllowsDeckInitScripts,
  getDeckRuntimeCsp,
  getRuntimeCsp,
  runtimeModeAllowsDeckScripts,
  runtimeModeToBridgePreviewMode,
  toAbsoluteRuntimeAssetSource,
  type DeckRuntimeMode,
} from '@ark/runtime-registry/deck-runtime.ts'
import { generateCspNonce } from './csp-nonce.ts'
import {
  findSlideElements,
  SLIDE_SELECTOR_CHAIN,
  stripHostileNavigationFromHtml,
  stripHostileNavigationVectors,
} from './preview-slides.ts'
import {
  deckUsesChartJsAddon,
  getApprovedRuntimeAssetUrls,
  hasApprovedRevealRuntimeInDocument,
  isApprovedRuntimeAssetUrl,
} from '@ark/runtime-registry/deck-runtime-registry.ts'
import { buildMetricCloneFontFaceCss } from '@ark/runtime-registry/deck-font-registry.ts'
import { absolutizeArkAssetReferences } from '@ark/deck/document/assets.ts'

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

function buildHistoryShimSource() {
  return `(function () {
  function safeHistoryCall(method) {
    var original = history[method];

    if (typeof original !== 'function') {
      return;
    }

    history[method] = function () {
      try {
        return original.apply(history, arguments);
      } catch (error) {}
    };
  }

  safeHistoryCall('replaceState');
  safeHistoryCall('pushState');
})();`
}

const previewFillStyleContent = `
  html,
  body {
    width: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
  }

  [data-ark-hidden] {
    display: none !important;
  }
`

const INLINE_HANDLER_PATTERN = /^on[a-z]+$/i

function ensureHead(doc: Document) {
  if (doc.head) {
    return doc.head
  }

  const head = doc.createElement('head')
  const root = doc.documentElement

  if (doc.body) {
    root.insertBefore(head, doc.body)
  } else {
    root.insertBefore(head, root.firstChild)
  }

  return head
}

function ensureBody(doc: Document) {
  if (doc.body) {
    return doc.body
  }

  const body = doc.createElement('body')

  doc.documentElement.append(body)

  return body
}

function appendScript(
  doc: Document,
  parent: Element,
  source: string,
  marker: string,
  nonce: string | null,
  position: 'start' | 'end' = 'end',
) {
  const script = doc.createElement('script')

  script.setAttribute(marker, '')

  if (nonce) {
    script.setAttribute('nonce', nonce)
  }

  script.textContent = `\n${source}\n`

  if (position === 'start') {
    parent.insertBefore(script, parent.firstChild)
    return
  }

  parent.append(script)
}

function appendPreviewFill(
  doc: Document,
  options: { historyShim?: boolean; nonce?: string | null; assetOrigin?: string | null } = {},
) {
  const head = ensureHead(doc)

  if (options.historyShim) {
    appendScript(
      doc,
      head,
      buildHistoryShimSource(),
      'data-ark-preview-history-shim',
      options.nonce ?? null,
    )
  }

  const style = doc.createElement('style')

  style.setAttribute('data-ark-preview-fill', '')
  style.textContent = previewFillStyleContent
  head.append(style)

  const fontFace = doc.createElement('style')
  fontFace.setAttribute('data-ark-metric-fonts', '')
  fontFace.textContent = `\n${absolutizeApprovedRuntimeAssetText(buildMetricCloneFontFaceCss(), options.assetOrigin)}\n`
  head.append(fontFace)
}

function injectRuntimeCspMeta(
  doc: Document,
  mode: DeckRuntimeMode,
  options: { assetOrigin?: string | null; nonce?: string | null },
) {
  const head = ensureHead(doc)
  const meta = doc.createElement('meta')
  const csp = documentAllowsDeckInitScripts(doc)
    ? getDeckRuntimeCsp(doc, mode, options)
    : getRuntimeCsp(mode, options)

  meta.setAttribute('http-equiv', 'Content-Security-Policy')
  meta.setAttribute('content', csp)
  head.insertBefore(meta, head.firstChild)
}

let cachedApprovedRuntimeAssetUrls: readonly string[] | null = null

function getCachedApprovedRuntimeAssetUrls() {
  return (
    cachedApprovedRuntimeAssetUrls ??
    (cachedApprovedRuntimeAssetUrls = getApprovedRuntimeAssetUrls())
  )
}

/** Rewrite approved runtime asset URLs inside text (for injected CSS). */
export function absolutizeApprovedRuntimeAssetText(value: string, assetOrigin?: string | null) {
  if (!assetOrigin?.trim()) {
    return value
  }

  let output = value

  for (const assetUrl of getCachedApprovedRuntimeAssetUrls()) {
    const absoluteUrl = toAbsoluteRuntimeAssetSource(assetUrl, { assetOrigin })

    if (!absoluteUrl) {
      continue
    }

    output = output
      .replaceAll(`"${assetUrl}"`, `"${absoluteUrl}"`)
      .replaceAll(`'${assetUrl}'`, `'${absoluteUrl}'`)
  }

  return output
}

function absolutizeApprovedRuntimeAssetAttribute(value: string, assetOrigin?: string | null) {
  if (!assetOrigin?.trim()) {
    return value
  }

  for (const assetUrl of getCachedApprovedRuntimeAssetUrls()) {
    if (value === assetUrl) {
      return toAbsoluteRuntimeAssetSource(assetUrl, { assetOrigin }) ?? value
    }
  }

  return value
}

/**
 * Rewrite Ark asset and approved-runtime URLs to absolute app-origin URLs.
 * Exported so live slide patches sanitize replacement markup exactly like the
 * full preview document does.
 */
export function absolutizePreviewAssetReferences(root: Element, assetOrigin?: string | null) {
  if (!assetOrigin?.trim()) {
    return
  }

  const walker = (root.ownerDocument ?? document).createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT,
  )
  let node: Node | null = walker.currentNode

  while (node) {
    if (node.nodeType === 1) {
      const element = node as Element

      for (const attribute of [...element.attributes]) {
        const rewritten = absolutizeArkAssetReferences(
          absolutizeApprovedRuntimeAssetAttribute(attribute.value, assetOrigin),
          assetOrigin,
        )

        if (rewritten !== attribute.value) {
          element.setAttribute(attribute.name, rewritten)
        }
      }
    } else if (node.nodeValue) {
      const rewritten = absolutizeArkAssetReferences(
        absolutizeApprovedRuntimeAssetText(node.nodeValue, assetOrigin),
        assetOrigin,
      )

      if (rewritten !== node.nodeValue) {
        node.nodeValue = rewritten
      }
    }

    node = walker.nextNode()
  }
}

function injectHandshakeSentinel(doc: Document, options: PreviewHtmlOptions, nonce: string | null) {
  const handshake = options.handshake?.trim()

  if (!handshake) {
    return
  }

  appendScript(
    doc,
    ensureHead(doc),
    buildDeckHandshakeSentinelScript(
      handshake,
      options.parentOrigin,
      doc.querySelector('script[data-ark-preview-editor]') ? EDITOR_SESSION_HANDOFF_KEY : undefined,
    ),
    'data-ark-preview-handshake',
    nonce,
    'start',
  )
}

function applyPreviewNonce(
  doc: Document,
  options: { noncePlaceholder?: string | null; nonce?: string | null },
) {
  const nonce = options.nonce?.trim()
  const placeholder = options.noncePlaceholder?.trim()

  if (!nonce || !placeholder || nonce === placeholder) {
    return
  }

  doc.querySelectorAll('[nonce]').forEach((element) => {
    if (element.getAttribute('nonce') === placeholder) {
      element.setAttribute('nonce', nonce)
    }
  })

  const placeholderSource = `'nonce-${placeholder}'`
  const nonceSource = `'nonce-${nonce}'`

  doc.querySelectorAll('meta[http-equiv]').forEach((meta) => {
    if (meta.getAttribute('http-equiv')?.trim().toLowerCase() !== 'content-security-policy') {
      return
    }

    const content = meta.getAttribute('content')

    if (content?.includes(placeholderSource)) {
      meta.setAttribute('content', content.replaceAll(placeholderSource, nonceSource))
    }
  })
}

function appendEditorBridgeInjection(
  doc: Document,
  parent: Element,
  options: PreviewHtmlOptions,
  runtimeOptions: { slideSelectors: readonly string[]; parentOrigin?: string },
  nonce: string | null,
) {
  if (!options.editorBridge) {
    return
  }

  appendScript(
    doc,
    parent,
    buildDeckEditorBridgeRuntimeScript({
      slideSelectors: runtimeOptions.slideSelectors,
      parentOrigin: runtimeOptions.parentOrigin,
    }),
    'data-ark-preview-editor',
    nonce,
    'start',
  )
}

function stripInlineHandlers(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  let node = walker.currentNode as Element | null

  while (node) {
    for (const attribute of [...node.attributes]) {
      if (INLINE_HANDLER_PATTERN.test(attribute.name)) {
        node.removeAttribute(attribute.name)
      }
    }

    node = walker.nextNode() as Element | null
  }
}

function shouldPreserveScript(script: HTMLScriptElement, preserveApprovedRuntimeScripts: boolean) {
  return (
    preserveApprovedRuntimeScripts &&
    isApprovedRuntimeAssetUrl(script.getAttribute('src'), 'script')
  )
}

function stripScripts(
  root: ParentNode,
  options: { preserveApprovedRuntimeScripts?: boolean } = {},
) {
  root.querySelectorAll('script').forEach((script) => {
    if (shouldPreserveScript(script, Boolean(options.preserveApprovedRuntimeScripts))) {
      return
    }

    script.remove()
  })
}

/**
 * Remove deck scripts and inline `on*` handlers from a preview subtree.
 * Exported so live slide patches sanitize replacement markup exactly like the
 * full preview document does.
 */
export function stripPreviewScriptsAndHandlers(
  root: ParentNode & Element,
  options: { preserveApprovedRuntimeScripts?: boolean } = {},
) {
  stripScripts(root, options)
  stripInlineHandlers(root)
}

function stripDeckScriptsAndHandlers(
  doc: Document,
  options: { preserveApprovedRuntimeScripts?: boolean } = {},
) {
  if (!doc.documentElement) {
    return
  }

  stripPreviewScriptsAndHandlers(doc.documentElement, options)
}

function serializePreviewDocument(doc: Document) {
  const root = doc.documentElement?.outerHTML ?? ''

  return root ? `<!DOCTYPE html>\n${root}` : ''
}

function finalizePreviewHtml(doc: Document): string {
  return stripHostileNavigationFromHtml(serializePreviewDocument(doc))
}

/**
 * Mark slide 0 visible and hide siblings before CSS-nav JS runs so the first
 * paint already shows the active slide (benchmark `preview_active_slide_ms`).
 */
function activateInitialCssNavSlide(doc: Document, slideIndex = 0) {
  const slides = findSlideElements(doc)

  if (slides.length === 0) {
    return
  }

  const activeIndex = Math.min(Math.max(0, Math.trunc(slideIndex) || 0), slides.length - 1)

  for (let index = 0; index < slides.length; index += 1) {
    const slide = slides[index]!
    const isActive = index === activeIndex

    if (isActive) {
      slide.removeAttribute('data-ark-hidden')
      slide.setAttribute('data-ark-active', '')
      slide.classList.add('active', 'is-active', 'present')
      slide.setAttribute('aria-hidden', 'false')
      slide.setAttribute('data-active', '')
    } else {
      slide.removeAttribute('data-ark-active')
      slide.setAttribute('data-ark-hidden', '')
      slide.classList.remove('active', 'is-active', 'present')
      slide.setAttribute('aria-hidden', 'true')
      slide.removeAttribute('data-active')
    }
  }
}

/**
 * Build the full preview document, returning HTML plus the CSP nonce used for
 * Ark-injected scripts (null in custom-js mode). Prefer this over
 * {@link buildPreviewHtml} when the caller also needs to set a matching HTTP
 * response CSP header.
 */
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
