import { findSlideElements } from './deck-slides'
import {
  detectRuntimeModeFromDocument,
  runtimeModeAllowsDeckScripts,
  type DeckRuntimeMode,
} from './deck-runtime'

export type DeckPreviewMode = DeckRuntimeMode

export type DeckScriptInfo = {
  inline: boolean
  src?: string
  type?: string
}

export type DeckMalformedSlide = {
  index: number
  reason: 'nested_slide' | 'empty'
}

export type DeckRuntimeMarkers = {
  runtimeMode: DeckRuntimeMode
  arkDeck: string | null
  arkPreview: string | null
  arkRuntime: string | null
}

export type DeckValidationIssueCode =
  | 'missing_doctype'
  | 'missing_html'
  | 'missing_body'
  | 'parser_error'
  | 'no_slides'
  | 'nested_slides'
  | 'empty_slide'
  | 'form'
  | 'iframe'
  | 'script_without_marker'
  | 'tracking'
  | 'external_url'

export type DeckValidationIssue = {
  code: DeckValidationIssueCode
  message: string
  severity: 'error' | 'warning'
}

export type DeckValidationReport = {
  valid: boolean
  slideCount: number
  scripts: DeckScriptInfo[]
  forms: number
  iframes: number
  externalUrls: string[]
  malformedSlides: DeckMalformedSlide[]
  runtimeMarkers: DeckRuntimeMarkers
  issues: DeckValidationIssue[]
}

const TRACKING_PATTERN =
  /(?:google-analytics|googletagmanager|gtag\s*\(|ga\s*\(|mixpanel|segment\.com|hotjar|plausible|analytics\.js|fbevents\.js)/i

const EXTERNAL_URL_PATTERN = /^https?:\/\//i

function isExternalUrl(value: string | null | undefined) {
  return Boolean(value?.trim() && EXTERNAL_URL_PATTERN.test(value.trim()))
}

function collectExternalUrls(doc: Document) {
  const urls = new Set<string>()

  for (const element of doc.querySelectorAll('[src], [href]')) {
    const src = element.getAttribute('src')
    const href = element.getAttribute('href')

    if (isExternalUrl(src)) {
      urls.add(src!.trim())
    }

    if (
      isExternalUrl(href) &&
      (element.tagName === 'LINK' ||
        element.tagName === 'A' ||
        element.tagName === 'SCRIPT' ||
        element.tagName === 'IMG' ||
        element.tagName === 'IFRAME')
    ) {
      urls.add(href!.trim())
    }
  }

  for (const style of doc.querySelectorAll('style')) {
    const importMatches = style.textContent?.matchAll(/@import\s+url\((['"]?)(https?:\/\/[^)'"]+)\1\)/gi)

    if (importMatches) {
      for (const match of importMatches) {
        if (match[2]) {
          urls.add(match[2])
        }
      }
    }
  }

  return [...urls].sort()
}

function readRuntimeMarkers(doc: Document): DeckRuntimeMarkers {
  const html = doc.documentElement
  const body = doc.body
  const arkDeck =
  html?.getAttribute('data-ark-deck') ?? body?.getAttribute('data-ark-deck') ?? null
  const arkPreview =
  html?.getAttribute('data-ark-preview') ?? body?.getAttribute('data-ark-preview') ?? null
  const arkRuntime =
  html?.getAttribute('data-ark-runtime') ?? body?.getAttribute('data-ark-runtime') ?? null

  return {
    runtimeMode: detectRuntimeModeFromDocument(doc),
    arkDeck,
    arkPreview,
    arkRuntime,
  }
}

function collectScripts(doc: Document): DeckScriptInfo[] {
  return [...doc.querySelectorAll('script')].map((script) => ({
    inline: !script.hasAttribute('src'),
    src: script.getAttribute('src') ?? undefined,
    type: script.getAttribute('type') ?? undefined,
  }))
}

function hasTrackingSignals(doc: Document, scripts: DeckScriptInfo[]) {
  if (scripts.some((script) => script.src && TRACKING_PATTERN.test(script.src))) {
    return true
  }

  for (const script of doc.querySelectorAll('script')) {
    const content = script.textContent ?? ''

    if (TRACKING_PATTERN.test(content)) {
      return true
    }
  }

  return false
}

function findMalformedSlides(slides: Element[]) {
  const malformedSlides: DeckMalformedSlide[] = []

  slides.forEach((slide, index) => {
  const nestedSlide = slide.querySelector('section.slide, body > section, .slides > section')

    if (nestedSlide) {
      malformedSlides.push({ index, reason: 'nested_slide' })
    }

    const text = slide.textContent?.replace(/\s+/g, '').trim() ?? ''

    if (!text) {
      malformedSlides.push({ index, reason: 'empty' })
    }
  })

  return malformedSlides
}

function hasDoctype(rawHtml: string | undefined, doc: Document) {
  if (rawHtml && /<!doctype\s+html/i.test(rawHtml)) {
    return true
  }

  return doc.doctype?.name.toLowerCase() === 'html'
}

function pushIssue(
  issues: DeckValidationIssue[],
  issue: DeckValidationIssue,
) {
  issues.push(issue)
}

export function validateDeckDocument(
  doc: Document,
  rawHtml?: string,
): DeckValidationReport {
  const issues: DeckValidationIssue[] = []
  const parserError = doc.querySelector('parsererror')

  if (parserError) {
    pushIssue(issues, {
      code: 'parser_error',
      message: 'The HTML could not be parsed as a document.',
      severity: 'error',
    })
  }

  if (!doc.documentElement || doc.documentElement.tagName !== 'HTML') {
    pushIssue(issues, {
      code: 'missing_html',
      message: 'The deck must include an <html> element.',
      severity: 'error',
    })
  }

  if (!doc.body) {
    pushIssue(issues, {
      code: 'missing_body',
      message: 'The deck must include a <body> element.',
      severity: 'error',
    })
  }

  if (!hasDoctype(rawHtml, doc)) {
    pushIssue(issues, {
      code: 'missing_doctype',
      message: 'The deck should include <!DOCTYPE html>.',
      severity: 'warning',
    })
  }

  const slideElements = findSlideElements(doc)
  const slideCount = slideElements.length

  if (slideCount === 0) {
    pushIssue(issues, {
      code: 'no_slides',
      message: 'No slides were found. Use <section class="slide"> or another supported slide selector.',
      severity: 'error',
    })
  }

  const malformedSlides = findMalformedSlides(slideElements)

  for (const malformedSlide of malformedSlides) {
    if (malformedSlide.reason === 'nested_slide') {
      pushIssue(issues, {
        code: 'nested_slides',
        message: `Slide ${malformedSlide.index + 1} contains another slide section.`,
        severity: 'error',
      })
    }

    if (malformedSlide.reason === 'empty') {
      pushIssue(issues, {
        code: 'empty_slide',
        message: `Slide ${malformedSlide.index + 1} has no visible content.`,
        severity: 'warning',
      })
    }
  }

  const forms = doc.querySelectorAll('form').length

  if (forms > 0) {
    pushIssue(issues, {
      code: 'form',
      message: `Found ${forms} form element${forms === 1 ? '' : 's'}. Forms are not allowed in Ark decks.`,
      severity: 'error',
    })
  }

  const iframes = doc.querySelectorAll('iframe').length

  if (iframes > 0) {
    pushIssue(issues, {
      code: 'iframe',
      message: `Found ${iframes} iframe element${iframes === 1 ? '' : 's'}. Nested iframes are not allowed.`,
      severity: 'error',
    })
  }

  const scripts = collectScripts(doc)
  const runtimeMarkers = readRuntimeMarkers(doc)

  if (scripts.length > 0 && !runtimeModeAllowsDeckScripts(runtimeMarkers.runtimeMode)) {
    pushIssue(issues, {
      code: 'script_without_marker',
      message:
        'Deck scripts require data-ark-deck="nav" or data-ark-preview="full-js" on <html> or <body>.',
      severity: 'warning',
    })
  }

  if (hasTrackingSignals(doc, scripts)) {
    pushIssue(issues, {
      code: 'tracking',
      message: 'Possible analytics or tracking code was detected.',
      severity: 'error',
    })
  }

  const externalUrls = collectExternalUrls(doc)

  if (externalUrls.length > 0) {
    pushIssue(issues, {
      code: 'external_url',
      message: `Found ${externalUrls.length} external URL${externalUrls.length === 1 ? '' : 's'}.`,
      severity: 'warning',
    })
  }

  const hasBlockingIssue = issues.some((issue) => issue.severity === 'error')

  return {
    valid: !hasBlockingIssue && slideCount > 0,
    slideCount,
    scripts,
    forms,
    iframes,
    externalUrls,
    malformedSlides,
    runtimeMarkers,
    issues,
  }
}

export function validateDeckHtml(
  html: string,
  parseDocument: (source: string) => Document,
): DeckValidationReport {
  if (!html.trim()) {
    return {
      valid: false,
      slideCount: 0,
      scripts: [],
      forms: 0,
      iframes: 0,
      externalUrls: [],
      malformedSlides: [],
      runtimeMarkers: {
        runtimeMode: 'static',
        arkDeck: null,
        arkPreview: null,
        arkRuntime: null,
      },
      issues: [
        {
          code: 'missing_html',
          message: 'The deck is empty.',
          severity: 'error',
        },
      ],
    }
  }

  const doc = parseDocument(html)

  return validateDeckDocument(doc, html)
}

export function validateDeckHtmlInBrowser(html: string): DeckValidationReport {
  return validateDeckHtml(html, (source) => new DOMParser().parseFromString(source, 'text/html'))
}

export function formatDeckValidationSummary(report: DeckValidationReport) {
  const parts = [`${report.slideCount} slide${report.slideCount === 1 ? '' : 's'}`]

  if (report.scripts.length > 0) {
    parts.push(`${report.scripts.length} script${report.scripts.length === 1 ? '' : 's'}`)
  }

  if (report.forms > 0) {
    parts.push(`${report.forms} form${report.forms === 1 ? '' : 's'}`)
  }

  if (report.iframes > 0) {
    parts.push(`${report.iframes} iframe${report.iframes === 1 ? '' : 's'}`)
  }

  if (report.externalUrls.length > 0) {
    parts.push(`${report.externalUrls.length} external URL${report.externalUrls.length === 1 ? '' : 's'}`)
  }

  if (runtimeModeAllowsDeckScripts(report.runtimeMarkers.runtimeMode)) {
    parts.push('custom-JS preview')
  } else if (report.runtimeMarkers.runtimeMode === 'reveal') {
    parts.push('reveal runtime')
  }

  return parts.join(', ')
}
