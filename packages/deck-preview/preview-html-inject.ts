import { buildDeckHandshakeSentinelScript } from './runtime/index.ts'
import { buildDeckEditorBridgeRuntimeScript, EDITOR_SESSION_HANDOFF_KEY } from '@ark/editor-runtime'
import {
  documentAllowsDeckInitScripts,
  getDeckRuntimeCsp,
  getRuntimeCsp,
  toAbsoluteRuntimeAssetSource,
} from '@ark/runtime-registry/deck-runtime.ts'
import { findSlideElements, stripHostileNavigationFromHtml } from './preview-slides.ts'
import {
  getApprovedRuntimeAssetUrls,
  isApprovedRuntimeAssetUrl,
} from '@ark/runtime-registry/deck-runtime-registry.ts'
import { buildMetricCloneFontFaceCss } from '@ark/runtime-registry/deck-font-registry.ts'
import { absolutizeArkAssetReferences } from '@ark/deck/document/assets.ts'
import type { PreviewHtmlOptions } from './preview-html.ts'

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

export function ensureHead(doc: Document) {
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

export function ensureBody(doc: Document) {
  if (doc.body) {
    return doc.body
  }

  const body = doc.createElement('body')

  doc.documentElement.append(body)

  return body
}

export function appendScript(
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

export function appendPreviewFill(
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

export function injectRuntimeCspMeta(
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

export function injectHandshakeSentinel(
  doc: Document,
  options: PreviewHtmlOptions,
  nonce: string | null,
) {
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

export function applyPreviewNonce(
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

export function appendEditorBridgeInjection(
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

export function stripInlineHandlers(root: ParentNode) {
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

export function stripDeckScriptsAndHandlers(
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

export function finalizePreviewHtml(doc: Document): string {
  return stripHostileNavigationFromHtml(serializePreviewDocument(doc))
}

/**
 * Mark slide 0 visible and hide siblings before CSS-nav JS runs so the first
 * paint already shows the active slide (benchmark `preview_active_slide_ms`).
 */
export function activateInitialCssNavSlide(doc: Document, slideIndex = 0) {
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
