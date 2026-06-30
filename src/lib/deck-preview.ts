import type { CSSProperties } from 'react'

import {
  buildDeckBridgeRuntimeScript,
  buildDeckCssNavRuntimeScript,
} from '../../shared/deck-bridge.ts'
import { SLIDE_SELECTOR_CHAIN, stripDeckScriptsForPreview } from '@/lib/deck-slides'
import {
  detectRuntimeMode,
  injectRuntimeCsp,
  runtimeModeAllowsDeckScripts,
  runtimeModeToBridgePreviewMode,
  type DeckRuntimeMode,
} from '@/lib/deck-runtime'

export {
  DECK_GOTO_EVENT,
  DECK_GOTO_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_EVENT,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
} from '../../shared/deck-bridge.ts'

export const PREVIEW_FRAME_WIDTH = 1600
export const PREVIEW_FRAME_HEIGHT = 900
export const PREVIEW_FRAME_ASPECT_RATIO = `${PREVIEW_FRAME_WIDTH} / ${PREVIEW_FRAME_HEIGHT}`

export type ElementSize = {
  width: number
  height: number
}

export function getPreviewFrameScale({ width, height }: ElementSize) {
  const scale = Math.min(width / PREVIEW_FRAME_WIDTH, height / PREVIEW_FRAME_HEIGHT)

  if (!Number.isFinite(scale) || scale <= 0) {
    return 0
  }

  return scale
}

export function getPreviewStageStyle(scale: number): CSSProperties {
  if (scale <= 0) {
    return {
      aspectRatio: PREVIEW_FRAME_ASPECT_RATIO,
      width: '100%',
      maxHeight: '100%',
    }
  }

  return {
    width: PREVIEW_FRAME_WIDTH * scale,
    height: PREVIEW_FRAME_HEIGHT * scale,
  }
}

export function getPreviewFrameStyle(scale: number): CSSProperties {
  return {
    width: PREVIEW_FRAME_WIDTH,
    height: PREVIEW_FRAME_HEIGHT,
    transform: `scale(${scale || 1})`,
    transformOrigin: 'top left',
    visibility: scale > 0 ? 'visible' : 'hidden',
  }
}

export type { DeckRuntimeMode } from '@/lib/deck-runtime'

export { detectRuntimeMode, getPreviewSandbox, getThumbnailSandbox } from '@/lib/deck-runtime'

/** @deprecated Use {@link detectRuntimeMode} instead. */
export function detectPreviewMode(html: string): DeckRuntimeMode {
  return detectRuntimeMode(html)
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

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${headInjection}\n</head>`)
  }

  return `${headInjection}\n${html}`
}

function injectBeforeBodyClose(html: string, injection: string) {
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${injection}\n</body>`)
  }

  return `${html}\n${injection}`
}

export function getPreviewHtml(html: string) {
  if (!html) {
    return ''
  }

  const mode = detectRuntimeMode(html)
  const withCsp = injectRuntimeCsp(html, mode)
  const runtimeOptions = {
    slideSelectors: SLIDE_SELECTOR_CHAIN,
    previewMode: runtimeModeToBridgePreviewMode(mode),
  }

  if (runtimeModeAllowsDeckScripts(mode)) {
    return injectBeforeBodyClose(
      injectPreviewFill(withCsp, { historyShim: true }),
      wrapRuntimeScript(
        buildDeckBridgeRuntimeScript(runtimeOptions),
        'data-ark-preview-bridge',
      ),
    )
  }

  const strippedHtml = stripDeckScriptsForPreview(withCsp)

  return injectBeforeBodyClose(
    injectPreviewFill(strippedHtml),
    wrapRuntimeScript(
      buildDeckCssNavRuntimeScript(runtimeOptions),
      'data-ark-preview-nav',
    ),
  )
}
