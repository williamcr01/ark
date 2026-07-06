import { injectPreviewCsp } from './deck-network.ts'
import {
  buildDeckBridgeRuntimeScript,
  buildDeckCssNavRuntimeScript,
  buildRevealNavRuntimeScript,
} from './deck-bridge.ts'
import { buildDeckEditorBridgeRuntimeScript } from './deck-editor-bridge.ts'
import type { DeckRuntimeManifest } from './deck-runtime-manifest.ts'
import {
  detectRuntimeMode,
  injectRuntimeCsp,
  runtimeModeAllowsDeckScripts,
  runtimeModeToBridgePreviewMode,
  toAbsoluteRuntimeAssetSource,
  usesRevealRuntimeAdapter,
} from './deck-runtime.ts'
import { SLIDE_SELECTOR_CHAIN, stripDeckScriptsForPreview } from './deck-preview-slides.ts'
import { getApprovedRuntimeAssetUrls } from './deck-runtime-registry.ts'

export type PreviewHtmlOptions = {
  parentOrigin?: string
  manifest?: Pick<DeckRuntimeManifest, 'runtimeMode' | 'usesRevealAdapter' | 'previewMode'>
  editorBridge?: boolean
}

const previewHistoryShim = `
<script data-ark-preview-history-shim>
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

function wrapRuntimeScript(source: string, marker: string) {
  return `<script ${marker}>\n${source}\n</script>`
}

function injectPreviewFill(html: string, options: { historyShim?: boolean } = {}) {
  const headInjection = `${options.historyShim ? `${previewHistoryShim}\n` : ''}${previewFillStyle}`

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

function buildEditorBridgeInjection(
  options: PreviewHtmlOptions,
  runtimeOptions: { slideSelectors: readonly string[]; parentOrigin?: string },
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
  )
}

export function buildPreviewHtml(html: string, options: PreviewHtmlOptions = {}) {
  if (!html) {
    return ''
  }

  const mode = options.manifest?.runtimeMode ?? detectRuntimeMode(html)
  const usesRevealAdapter = options.manifest?.usesRevealAdapter ?? usesRevealRuntimeAdapter(html)
  const assetOrigin = options.parentOrigin
  const withCsp = injectRuntimeCsp(html, mode, { assetOrigin })
  const runtimeOptions = {
    slideSelectors: SLIDE_SELECTOR_CHAIN,
    previewMode: runtimeModeToBridgePreviewMode(mode, { usesRevealAdapter }),
    parentOrigin: options.parentOrigin,
  }

  if (runtimeModeAllowsDeckScripts(mode)) {
    return injectRuntimeScripts(
      injectPreviewFill(absolutizeApprovedRuntimeAssetReferences(withCsp, assetOrigin), {
        historyShim: true,
      }),
      [
        wrapRuntimeScript(buildDeckBridgeRuntimeScript(runtimeOptions), 'data-ark-preview-bridge'),
        buildEditorBridgeInjection(options, runtimeOptions),
      ].filter(Boolean),
    )
  }

  if (usesRevealAdapter) {
    const strippedHtml = stripDeckScriptsForPreview(withCsp, {
      preserveApprovedRuntimeScripts: true,
    })
    const previewHtml = absolutizeApprovedRuntimeAssetReferences(strippedHtml, assetOrigin)

    return injectRuntimeScripts(
      injectPreviewFill(previewHtml, { historyShim: true }),
      [
        wrapRuntimeScript(buildRevealNavRuntimeScript(runtimeOptions), 'data-ark-preview-reveal'),
        buildEditorBridgeInjection(options, runtimeOptions),
      ].filter(Boolean),
    )
  }

  const strippedHtml = stripDeckScriptsForPreview(withCsp, {
    preserveApprovedRuntimeScripts: mode === 'reveal',
  })
  const previewHtml = absolutizeApprovedRuntimeAssetReferences(strippedHtml, assetOrigin)

  return injectRuntimeScripts(
    injectPreviewFill(previewHtml),
    [
      wrapRuntimeScript(buildDeckCssNavRuntimeScript(runtimeOptions), 'data-ark-preview-nav'),
      buildEditorBridgeInjection(options, runtimeOptions),
    ].filter(Boolean),
  )
}

/** @deprecated Use {@link buildPreviewHtml} */
export const getPreviewHtml = buildPreviewHtml
