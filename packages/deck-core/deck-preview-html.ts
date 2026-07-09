import { injectPreviewCsp } from './deck-network.ts'
import {
  buildDeckBridgeRuntimeScript,
  buildDeckCssNavRuntimeScript,
  buildDeckHandshakeSentinelScript,
  buildRevealNavRuntimeScript,
} from './deck-bridge.ts'
import { buildDeckEditorBridgeRuntimeScript } from './deck-editor-bridge.ts'
import type { DeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'
import {
  detectRuntimeMode,
  injectRuntimeCsp,
  runtimeModeAllowsDeckScripts,
  runtimeModeToBridgePreviewMode,
  toAbsoluteRuntimeAssetSource,
  usesRevealRuntimeAdapter,
  type DeckRuntimeMode,
} from '@ark/runtime-registry/deck-runtime.ts'
import { generateCspNonce } from '@ark/runtime-registry/csp-nonce.ts'
import {
  SLIDE_SELECTOR_CHAIN,
  stripDeckScriptsForPreview,
  stripHostileNavigationFromHtml,
} from './deck-preview-slides.ts'
import { getApprovedRuntimeAssetUrls } from '@ark/runtime-registry/deck-runtime-registry.ts'

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
   * Generation-correlation handshake for the head sentinel.
   * Not a secret — full-JS decks can inspect the document.
   */
  handshake?: string
}

export type PreviewDocumentResult = {
  html: string
  runtimeMode: DeckRuntimeMode
  /** Nonce used for Ark-injected scripts + CSP; null for custom-js. */
  nonce: string | null
}

function buildHistoryShim(nonce: string | null) {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : ''
  return `
<script data-ark-preview-history-shim${nonceAttr}>
(function () {
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
})();
</script>`
}

const previewFillStyle = `
<style data-ark-preview-fill>
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

</style>`

function wrapRuntimeScript(source: string, marker: string, nonce: string | null) {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : ''
  return `<script ${marker}${nonceAttr}>\n${source}\n</script>`
}

function injectAtStartOfHead(html: string, injection: string) {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}\n${injection}`)
  }

  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (match) => `${match}\n<head>\n${injection}\n</head>`)
  }

  return `<head>\n${injection}\n</head>\n${html}`
}

function injectPreviewFill(
  html: string,
  options: { historyShim?: boolean; nonce?: string | null } = {},
) {
  const headInjection = `${
    options.historyShim ? `${buildHistoryShim(options.nonce ?? null)}\n` : ''
  }${previewFillStyle}`

  const withHeadInjection = /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `${headInjection}\n</head>`)
    : `${headInjection}\n${html}`

  return injectPreviewCsp(withHeadInjection)
}

function injectBeforeBodyClose(html: string, injection: string) {
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${injection}\n</body>`)
  }

  return `${html}\n${injection}`
}

function absolutizeApprovedRuntimeAssetReferences(html: string, assetOrigin?: string | null) {
  if (!assetOrigin?.trim()) {
    return html
  }

  let output = html

  for (const assetUrl of getApprovedRuntimeAssetUrls()) {
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

function injectRuntimeScripts(html: string, scripts: string[]) {
  if (scripts.length === 0) {
    return html
  }

  return injectBeforeBodyClose(html, scripts.join('\n'))
}

function injectHandshakeSentinel(html: string, options: PreviewHtmlOptions, nonce: string | null) {
  const handshake = options.handshake?.trim()

  if (!handshake) {
    return html
  }

  return injectAtStartOfHead(
    html,
    wrapRuntimeScript(
      buildDeckHandshakeSentinelScript(handshake, options.parentOrigin),
      'data-ark-preview-handshake',
      nonce,
    ),
  )
}

function buildEditorBridgeInjection(
  options: PreviewHtmlOptions,
  runtimeOptions: { slideSelectors: readonly string[]; parentOrigin?: string },
  nonce: string | null,
) {
  if (!options.editorBridge) {
    return ''
  }

  return wrapRuntimeScript(
    buildDeckEditorBridgeRuntimeScript({
      slideSelectors: runtimeOptions.slideSelectors,
      parentOrigin: runtimeOptions.parentOrigin,
    }),
    'data-ark-preview-editor',
    nonce,
  )
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

  const mode = options.manifest?.runtimeMode ?? detectRuntimeMode(html)
  const usesRevealAdapter = options.manifest?.usesRevealAdapter ?? usesRevealRuntimeAdapter(html)
  const assetOrigin = options.parentOrigin
  // Nonces neutralize javascript: URLs and slipped-past inline handlers in
  // CSS-only / reveal-adapter modes. custom-js must keep 'unsafe-inline'.
  const nonce = mode === 'custom-js' ? null : options.nonce?.trim() || generateCspNonce()
  const withCsp = injectRuntimeCsp(html, mode, { assetOrigin, nonce })
  // Meta refresh / javascript: URLs have no legitimate use in any preview mode.
  const sanitized = stripHostileNavigationFromHtml(withCsp)
  const runtimeOptions = {
    slideSelectors: SLIDE_SELECTOR_CHAIN,
    previewMode: runtimeModeToBridgePreviewMode(mode, { usesRevealAdapter }),
    parentOrigin: options.parentOrigin,
  }

  if (runtimeModeAllowsDeckScripts(mode)) {
    return {
      html: injectHandshakeSentinel(
        injectRuntimeScripts(
          injectPreviewFill(absolutizeApprovedRuntimeAssetReferences(sanitized, assetOrigin), {
            historyShim: true,
            nonce,
          }),
          [
            wrapRuntimeScript(
              buildDeckBridgeRuntimeScript(runtimeOptions),
              'data-ark-preview-bridge',
              nonce,
            ),
            buildEditorBridgeInjection(options, runtimeOptions, nonce),
          ].filter(Boolean),
        ),
        options,
        nonce,
      ),
      runtimeMode: mode,
      nonce,
    }
  }

  if (usesRevealAdapter) {
    const strippedHtml = stripDeckScriptsForPreview(sanitized, {
      preserveApprovedRuntimeScripts: true,
    })
    const previewHtml = absolutizeApprovedRuntimeAssetReferences(strippedHtml, assetOrigin)

    return {
      html: injectHandshakeSentinel(
        injectRuntimeScripts(
          injectPreviewFill(previewHtml, { historyShim: true, nonce }),
          [
            wrapRuntimeScript(
              buildRevealNavRuntimeScript(runtimeOptions),
              'data-ark-preview-reveal',
              nonce,
            ),
            buildEditorBridgeInjection(options, runtimeOptions, nonce),
          ].filter(Boolean),
        ),
        options,
        nonce,
      ),
      runtimeMode: mode,
      nonce,
    }
  }

  const strippedHtml = stripDeckScriptsForPreview(sanitized, {
    preserveApprovedRuntimeScripts: mode === 'reveal',
  })
  const previewHtml = absolutizeApprovedRuntimeAssetReferences(strippedHtml, assetOrigin)

  return {
    html: injectHandshakeSentinel(
      injectRuntimeScripts(
        injectPreviewFill(previewHtml, { nonce }),
        [
          wrapRuntimeScript(
            buildDeckCssNavRuntimeScript(runtimeOptions),
            'data-ark-preview-nav',
            nonce,
          ),
          buildEditorBridgeInjection(options, runtimeOptions, nonce),
        ].filter(Boolean),
      ),
      options,
      nonce,
    ),
    runtimeMode: mode,
    nonce,
  }
}

export function buildPreviewHtml(html: string, options: PreviewHtmlOptions = {}) {
  return buildPreviewDocument(html, options).html
}

/** @deprecated Use {@link buildPreviewHtml} */
export const getPreviewHtml = buildPreviewHtml
