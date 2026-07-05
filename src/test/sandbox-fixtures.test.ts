import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  DECK_GOTO_MESSAGE_TYPE,
  DECK_READY_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
  isDeckBridgeMessageFromRuntime,
  parseDeckBridgeMessage,
} from '../../shared/deck-bridge.ts'
import fullJsDeck from '@/test/fixtures/full-js-deck.html?raw'
import hostileBrokenRevealDeck from '@/test/fixtures/hostile-broken-reveal-deck.html?raw'
import hostileExternalFetchDeck from '@/test/fixtures/hostile-external-fetch-deck.html?raw'
import hostileFormsDeck from '@/test/fixtures/hostile-forms-deck.html?raw'
import hostileIframesDeck from '@/test/fixtures/hostile-iframes-deck.html?raw'
import hostileInvalidManifestDeck from '@/test/fixtures/hostile-invalid-manifest-deck.html?raw'
import hostileNavigationDeck from '@/test/fixtures/hostile-navigation-deck.html?raw'
import hostileObjectEmbedDeck from '@/test/fixtures/hostile-object-embed-deck.html?raw'
import hostilePopupsDeck from '@/test/fixtures/hostile-popups-deck.html?raw'
import hostilePostmessageDeck from '@/test/fixtures/hostile-postmessage-deck.html?raw'
import hostileRunawayScriptsDeck from '@/test/fixtures/hostile-runaway-scripts-deck.html?raw'
import hostileScriptsDeck from '@/test/fixtures/hostile-scripts-deck.html?raw'
import malformedDeck from '@/test/fixtures/malformed-deck.html?raw'
import plainCssDeck from '@/test/fixtures/plain-css-deck.html?raw'
import revealDeck from '@/test/fixtures/reveal-deck.html?raw'
import {
  detectRuntimeMode,
  getBlockedSandboxFeatures,
  getPreviewSandbox,
  getRuntimeCsp,
  getThumbnailSandbox,
  injectRuntimeCsp,
  runtimeModeAllowsDeckScripts,
} from '@/lib/deck-runtime'
import { getPreviewHtml } from '@/lib/deck-preview'
import { parseDeckSlides, stripDeckScriptsForPreview } from '@/lib/deck-slides'
import { validateDeckHtmlInBrowser } from '@/lib/deck-validate'

type SecurityFixture = {
  name: string
  html: string
  runtimeMode: 'static' | 'reveal' | 'custom-js'
  category: string
}

const securityFixtures: SecurityFixture[] = [
  { name: 'plain-css', html: plainCssDeck, runtimeMode: 'static', category: 'baseline' },
  { name: 'reveal', html: revealDeck, runtimeMode: 'reveal', category: 'baseline' },
  { name: 'full-js', html: fullJsDeck, runtimeMode: 'custom-js', category: 'baseline' },
  {
    name: 'hostile-scripts',
    html: hostileScriptsDeck,
    runtimeMode: 'static',
    category: 'script-injection',
  },
  {
    name: 'hostile-postmessage',
    html: hostilePostmessageDeck,
    runtimeMode: 'custom-js',
    category: 'postmessage-spoofing',
  },
  {
    name: 'hostile-external-fetch',
    html: hostileExternalFetchDeck,
    runtimeMode: 'static',
    category: 'external-fetch',
  },
  { name: 'hostile-forms', html: hostileFormsDeck, runtimeMode: 'static', category: 'forms' },
  {
    name: 'hostile-iframes',
    html: hostileIframesDeck,
    runtimeMode: 'static',
    category: 'nested-iframes',
  },
  {
    name: 'hostile-navigation',
    html: hostileNavigationDeck,
    runtimeMode: 'static',
    category: 'top-navigation',
  },
  { name: 'hostile-popups', html: hostilePopupsDeck, runtimeMode: 'static', category: 'popups' },
  {
    name: 'hostile-object-embed',
    html: hostileObjectEmbedDeck,
    runtimeMode: 'static',
    category: 'object-embed',
  },
  {
    name: 'hostile-runaway-scripts',
    html: hostileRunawayScriptsDeck,
    runtimeMode: 'static',
    category: 'runaway-scripts',
  },
  {
    name: 'hostile-invalid-manifest',
    html: hostileInvalidManifestDeck,
    runtimeMode: 'static',
    category: 'invalid-manifest',
  },
  {
    name: 'hostile-broken-reveal',
    html: hostileBrokenRevealDeck,
    runtimeMode: 'reveal',
    category: 'broken-reveal',
  },
  { name: 'malformed', html: malformedDeck, runtimeMode: 'static', category: 'malformed' },
]

function loadExecutablePreview(html: string) {
  return new Promise<JSDOM>((resolve) => {
    const parentMessages: unknown[] = []
    let parentWindow: { postMessage: (message: unknown) => void }

    const dom = new JSDOM(html, {
      pretendToBeVisual: true,
      runScripts: 'dangerously',
      url: 'https://ark.test/preview',
      beforeParse(window) {
        parentWindow = {
          postMessage(message: unknown) {
            parentMessages.push(message)
          },
        }

        Object.defineProperty(window, 'parent', {
          configurable: true,
          value: parentWindow,
        })
      },
    })

    ;(dom.window as unknown as Window & { __parentMessages: unknown[] }).__parentMessages =
      parentMessages

    dom.window.addEventListener('load', () => resolve(dom))
  })
}

function getParentMessages(dom: JSDOM) {
  return (dom.window as unknown as Window & { __parentMessages: unknown[] }).__parentMessages
}

describe('sandbox security fixtures', () => {
  it.each(securityFixtures)(
    'detects expected runtime mode for $name fixture',
    ({ html, runtimeMode }) => {
      expect(detectRuntimeMode(html)).toBe(runtimeMode)
    },
  )

  it('uses locked-down thumbnail sandbox and allow-scripts preview sandbox', () => {
    expect(getThumbnailSandbox()).toBe('')

    for (const fixture of securityFixtures) {
      expect(getPreviewSandbox(fixture.runtimeMode)).toBe('allow-scripts')
      expect(getPreviewSandbox(fixture.runtimeMode)).not.toContain('allow-same-origin')
    }
  })

  it('blocks risky sandbox features across all fixtures', () => {
    const blocked = getBlockedSandboxFeatures()

    expect(blocked).toEqual(
      expect.arrayContaining([
        'allow-same-origin',
        'allow-forms',
        'allow-popups',
        'allow-popups-to-escape-sandbox',
        'allow-top-navigation',
        'allow-top-navigation-by-user-activation',
        'allow-modals',
      ]),
    )

    for (const fixture of securityFixtures) {
      const sandbox = getPreviewSandbox(fixture.runtimeMode)

      for (const feature of blocked) {
        expect(sandbox).not.toContain(feature)
      }
    }
  })

  it('applies strict CSP with connect-src none across fixtures', () => {
    for (const fixture of securityFixtures) {
      const csp = getRuntimeCsp(fixture.runtimeMode)
      const injected = injectRuntimeCsp(fixture.html, fixture.runtimeMode)

      expect(csp).toContain("connect-src 'none'")
      expect(csp).toContain("object-src 'none'")
      expect(csp).toContain("frame-src 'none'")
      expect(csp).toContain("form-action 'none'")
      expect(csp).toContain("base-uri 'none'")
      expect(injected).toContain('Content-Security-Policy')
      expect(injected).toContain("connect-src 'none'")
    }
  })

  describe('script injection', () => {
    it('strips hostile scripts and inline handlers from preview HTML', () => {
      const stripped = stripDeckScriptsForPreview(hostileScriptsDeck)
      const previewHtml = getPreviewHtml(hostileScriptsDeck)

      expect(stripped).not.toContain('<script')
      expect(stripped).not.toContain('window.evilHead')
      expect(stripped).not.toContain('window.evilModule')
      expect(previewHtml).toContain('data-ark-preview-nav')
      expect(previewHtml).not.toContain('data-ark-preview-bridge')
      expect(previewHtml).not.toContain('window.evilHead')
      expect(previewHtml).not.toContain('window.evilModule')
      expect(previewHtml).not.toContain('onload=')
      expect(previewHtml).not.toContain('onclick=')
      expect(previewHtml).not.toContain('onerror=')
    })

    it('flags hostile scripts without an Ark runtime marker', () => {
      const report = validateDeckHtmlInBrowser(hostileScriptsDeck)

      expect(report.valid).toBe(true)
      expect(report.runtimeMarkers.runtimeMode).toBe('static')
      expect(report.issues.some((issue) => issue.code === 'script_without_marker')).toBe(true)
    })

    it('sanitizes thumbnail documents for hostile script fixtures', () => {
      const parsed = parseDeckSlides(hostileScriptsDeck)

      parsed.thumbnailSrcDocs.forEach((srcDoc) => {
        expect(srcDoc).not.toContain('<script')
        expect(srcDoc).not.toContain('onclick=')
        expect(srcDoc).not.toContain('onload=')
        expect(srcDoc).not.toContain('onerror=')
      })
    })
  })

  describe('postMessage spoofing', () => {
    it('keeps deck scripts only for opted-in custom-js decks', () => {
      const previewHtml = getPreviewHtml(hostilePostmessageDeck)

      expect(previewHtml).toContain('data-ark-preview-bridge')
      expect(previewHtml).toContain('ark:evil-command')
      expect(previewHtml).not.toContain('data-ark-preview-nav')
    })

    it('ignores goto messages that do not originate from the parent window', async () => {
      const dom = await loadExecutablePreview(getPreviewHtml(fullJsDeck))
      const receivedIndexes: number[] = []

      dom.window.document.addEventListener('ark:deck-goto', (event) => {
        receivedIndexes.push((event as CustomEvent<{ index: number }>).detail.index)
      })

      dom.window.dispatchEvent(
        new dom.window.MessageEvent('message', {
          data: { type: DECK_GOTO_MESSAGE_TYPE, index: 1 },
          source: dom.window as unknown as Window,
        }),
      )

      expect(receivedIndexes).toEqual([])
    })

    it('rejects malformed bridge payloads posted by hostile deck scripts', async () => {
      const dom = await loadExecutablePreview(getPreviewHtml(hostilePostmessageDeck))
      const messages = getParentMessages(dom)

      const accepted = messages.filter((message) => isDeckBridgeMessageFromRuntime(message))
      const spoofedReady = messages.find(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === DECK_READY_MESSAGE_TYPE,
      )

      expect(spoofedReady).toBeDefined()
      expect(accepted.some((message) => message === spoofedReady)).toBe(false)
      expect(
        messages.some(
          (message) =>
            typeof message === 'object' &&
            message !== null &&
            'type' in message &&
            message.type === DECK_SLIDE_CHANGE_MESSAGE_TYPE &&
            'index' in message &&
            message.index === 99,
        ),
      ).toBe(true)
      expect(
        messages.filter((message) => isDeckBridgeMessageFromRuntime(message)).length,
      ).toBeGreaterThan(0)
      expect(parseDeckBridgeMessage({ type: 'ark:evil-command', index: 0 })).toBeNull()
    })
  })

  describe('external fetches', () => {
    it('rejects decks with external network references', () => {
      const report = validateDeckHtmlInBrowser(hostileExternalFetchDeck)

      expect(report.valid).toBe(false)
      expect(report.externalUrls.length).toBeGreaterThan(0)
      expect(report.externalUrls).toEqual(
        expect.arrayContaining([
          'https://evil.example/styles.css',
          'https://evil.example/tracker.js',
          'https://evil.example/bg.png',
          'https://evil.example/logo.png',
        ]),
      )
      expect(report.issues.some((issue) => issue.code === 'external_url')).toBe(true)
      expect(report.issues.some((issue) => issue.code === 'script_without_marker')).toBe(true)
    })

    it('strips fetch and XHR scripts from static previews', () => {
      const previewHtml = getPreviewHtml(hostileExternalFetchDeck)

      expect(previewHtml).not.toContain('fetch(')
      expect(previewHtml).not.toContain('XMLHttpRequest')
      expect(previewHtml).toContain("connect-src 'none'")
    })
  })

  describe('forms', () => {
    it('rejects decks that contain form elements', () => {
      const report = validateDeckHtmlInBrowser(hostileFormsDeck)

      expect(report.valid).toBe(false)
      expect(report.forms).toBe(2)
      expect(report.issues.filter((issue) => issue.code === 'form')).toHaveLength(1)
    })
  })

  describe('nested iframes', () => {
    it('rejects decks that embed nested iframes', () => {
      const report = validateDeckHtmlInBrowser(hostileIframesDeck)

      expect(report.valid).toBe(false)
      expect(report.iframes).toBe(2)
      expect(report.issues.some((issue) => issue.code === 'iframe')).toBe(true)
      expect(report.issues.some((issue) => issue.code === 'external_url')).toBe(true)
    })
  })

  describe('top navigation', () => {
    it('strips navigation scripts and inline handlers from static previews', () => {
      const stripped = stripDeckScriptsForPreview(hostileNavigationDeck)
      const previewHtml = getPreviewHtml(hostileNavigationDeck)

      expect(stripped).not.toContain('window.top.location')
      expect(stripped).not.toContain('location.assign')
      expect(stripped).not.toContain('<script')
      expect(previewHtml).not.toContain('window.top.location')
      expect(previewHtml).not.toContain('location.assign')
      expect(previewHtml).toContain('data-ark-preview-nav')
      expect(previewHtml).toContain("base-uri 'none'")
    })

    it('flags external navigation targets during validation', () => {
      const report = validateDeckHtmlInBrowser(hostileNavigationDeck)

      expect(report.externalUrls).toEqual(
        expect.arrayContaining(['https://evil.example/top', 'https://evil.example/parent']),
      )
      expect(report.issues.some((issue) => issue.code === 'external_url')).toBe(true)
    })
  })

  describe('popups', () => {
    it('strips popup scripts and inline handlers from static previews', () => {
      const stripped = stripDeckScriptsForPreview(hostilePopupsDeck)
      const previewHtml = getPreviewHtml(hostilePopupsDeck)

      expect(stripped).not.toContain('window.open')
      expect(stripped).not.toContain('onclick=')
      expect(stripped).not.toContain('<script')
      expect(previewHtml).not.toContain('window.open')
      expect(previewHtml).not.toContain('onclick=')
      expect(previewHtml).toContain('data-ark-preview-nav')
    })

    it('does not grant popup permissions in preview sandbox', () => {
      expect(getPreviewSandbox('static')).not.toContain('allow-popups')
      expect(getBlockedSandboxFeatures()).toContain('allow-popups')
    })
  })

  describe('object and embed payloads', () => {
    it('flags external embed references and blocks object loads via CSP', () => {
      const report = validateDeckHtmlInBrowser(hostileObjectEmbedDeck)

      expect(report.valid).toBe(false)
      expect(report.externalUrls).toContain('https://evil.example/activex.dll')
      expect(report.issues.some((issue) => issue.code === 'external_url')).toBe(true)
    })

    it('blocks object loading via CSP in preview HTML', () => {
      const previewHtml = getPreviewHtml(hostileObjectEmbedDeck)

      expect(previewHtml).toContain("object-src 'none'")
    })
  })

  describe('runaway scripts', () => {
    it('strips infinite-loop scripts from static previews without executing them', () => {
      const stripped = stripDeckScriptsForPreview(hostileRunawayScriptsDeck)
      const previewHtml = getPreviewHtml(hostileRunawayScriptsDeck)

      expect(stripped).not.toContain('<script')
      expect(stripped).not.toContain('while (true)')
      expect(previewHtml).not.toContain('while (true)')
      expect(previewHtml).not.toContain('setInterval')
      expect(previewHtml).toContain('data-ark-preview-nav')
    })

    it('flags runaway scripts without an Ark runtime marker', () => {
      const report = validateDeckHtmlInBrowser(hostileRunawayScriptsDeck)

      expect(report.scripts.length).toBeGreaterThanOrEqual(2)
      expect(report.issues.some((issue) => issue.code === 'script_without_marker')).toBe(true)
      expect(runtimeModeAllowsDeckScripts(report.runtimeMarkers.runtimeMode)).toBe(false)
    })
  })

  describe('invalid runtime manifests', () => {
    it('flags unrecognized Ark markers as invalid runtime manifests', () => {
      const report = validateDeckHtmlInBrowser(hostileInvalidManifestDeck)

      expect(report.runtimeMarkers.runtimeMode).toBe('static')
      expect(report.runtimeMarkers.arkDeck).toBe('evil')
      expect(report.runtimeMarkers.arkPreview).toBe('yes')
      expect(report.runtimeMarkers.arkRuntime).toBe('hack')
      expect(report.issues.some((issue) => issue.code === 'invalid_runtime_marker')).toBe(true)
      expect(report.issues.some((issue) => issue.code === 'script_without_marker')).toBe(true)
    })

    it('strips scripts from invalid-manifest decks in static preview mode', () => {
      const previewHtml = getPreviewHtml(hostileInvalidManifestDeck)

      expect(previewHtml).not.toContain('window.invalidManifestBooted')
      expect(previewHtml).toContain('data-ark-preview-nav')
      expect(previewHtml).not.toContain('data-ark-preview-bridge')
    })
  })

  describe('broken reveal decks', () => {
    it('detects reveal markers but finds no valid slides', () => {
      const report = validateDeckHtmlInBrowser(hostileBrokenRevealDeck)

      expect(report.runtimeMarkers.runtimeMode).toBe('reveal')
      expect(report.runtimeMarkers.arkDeck).toBe('reveal')
      expect(report.slideCount).toBe(0)
      expect(report.valid).toBe(false)
      expect(report.issues.some((issue) => issue.code === 'no_slides')).toBe(true)
    })

    it('returns an empty parse result for broken reveal markup', () => {
      const parsed = parseDeckSlides(hostileBrokenRevealDeck)

      expect(parsed.slideCount).toBe(0)
      expect(parsed.slides).toEqual([])
      expect(parsed.thumbnailSrcDocs).toEqual([])
    })
  })

  describe('malformed decks', () => {
    it('rejects malformed nested-slide fixtures', () => {
      const report = validateDeckHtmlInBrowser(malformedDeck)

      expect(report.valid).toBe(false)
      expect(report.issues.some((issue) => issue.code === 'nested_slides')).toBe(true)
    })
  })
})
