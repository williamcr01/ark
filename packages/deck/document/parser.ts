import { JSDOM } from 'jsdom'

import type { SlideEditableElements } from '@ark/deck/document/editable.ts'
import { parseEditableElements, resolveSlideId } from '../patch/editable-elements.ts'
import { SLIDE_SELECTOR_CHAIN, findSlideElements } from './slides.ts'
import { utf8ByteLength } from './utf8.ts'
import { extractDeckTitle } from './title.ts'
import type { Logger } from '@ark/telemetry/logger.ts'
import { logTimedEvent, measureSync } from '@ark/telemetry/timing.ts'
import {
  readDeckFontSelection,
  type DeckFontSelection,
} from '@ark/runtime-registry/deck-font-registry.ts'
import {
  readDeckThemeFromDocument,
  readSlideRecipe,
  type DeckThemeSpecV1,
  type SlideRecipeRole,
} from './theme.ts'

export type DeckStructure = 'plain' | 'reveal' | 'unknown'

export type DeckPreviewMode = 'css-only' | 'full-js'

export type DeckRuntime = {
  previewMode: DeckPreviewMode
  arkDeck: string | null
  arkPreview: string | null
  arkRuntime: string | null
  arkRuntimeLib: string | null
  arkRuntimeVersion: string | null
}

export type DeckStyleBlock = {
  index: number
  inline: boolean
  href?: string
  media?: string
  content: string
}

export type DeckScriptBlock = {
  index: number
  inline: boolean
  src?: string
  type?: string
  contentLength: number
}

export type DeckAssetKind = 'img' | 'link' | 'script' | 'video' | 'audio' | 'source' | 'import'

export type DeckAssetReference = {
  kind: DeckAssetKind
  url: string
  slideIndex?: number
}

export type ParsedDeckSlide = {
  index: number
  slideId: string | null
  slideIdTransient: boolean
  title: string
  preview: string
  outerHTML: string
  notes: string | null
  kind: SlideRecipeRole | null
  layout: string | null
}

export type DeckParseResult = {
  title: string
  structure: DeckStructure
  runtime: DeckRuntime
  fonts: DeckFontSelection
  theme: DeckThemeSpecV1 | null
  slideSelector: string | null
  slideCount: number
  slides: ParsedDeckSlide[]
  editableElements: SlideEditableElements[]
  styles: DeckStyleBlock[]
  scripts: DeckScriptBlock[]
  assets: DeckAssetReference[]
}

const EXTERNAL_URL_PATTERN = /^https?:\/\//i

function isExternalUrl(value: string | null | undefined) {
  return Boolean(value?.trim() && EXTERNAL_URL_PATTERN.test(value.trim()))
}

function readRuntimeMarkers(doc: Document): DeckRuntime {
  const html = doc.documentElement
  const body = doc.body
  const arkDeck = html?.getAttribute('data-ark-deck') ?? body?.getAttribute('data-ark-deck') ?? null
  const arkPreview =
    html?.getAttribute('data-ark-preview') ?? body?.getAttribute('data-ark-preview') ?? null
  const arkRuntime =
    html?.getAttribute('data-ark-runtime') ?? body?.getAttribute('data-ark-runtime') ?? null
  const arkRuntimeLib =
    html?.getAttribute('data-ark-runtime-lib') ?? body?.getAttribute('data-ark-runtime-lib') ?? null
  const arkRuntimeVersion =
    html?.getAttribute('data-ark-runtime-version') ??
    body?.getAttribute('data-ark-runtime-version') ??
    null
  const previewMode: DeckPreviewMode =
    arkDeck === 'nav' || arkPreview === 'full-js' ? 'full-js' : 'css-only'

  return {
    previewMode,
    arkDeck,
    arkPreview,
    arkRuntime,
    arkRuntimeLib,
    arkRuntimeVersion,
  }
}

function detectSlideSelector(doc: Document) {
  for (const selector of SLIDE_SELECTOR_CHAIN) {
    const slides = doc.querySelectorAll(selector)

    if (slides.length > 0) {
      return selector
    }
  }

  return null
}

function detectDeckStructure(doc: Document, slideSelector: string | null): DeckStructure {
  if (!slideSelector) {
    return 'unknown'
  }

  if (slideSelector === '.reveal .slides > section') {
    return 'reveal'
  }

  if (doc.querySelector('.reveal')) {
    return 'reveal'
  }

  if (
    slideSelector === 'section.slide' ||
    slideSelector === 'body > section' ||
    slideSelector === 'main > section'
  ) {
    return 'plain'
  }

  if (slideSelector === '.slides > section') {
    return doc.querySelector('.reveal') ? 'reveal' : 'plain'
  }

  return 'unknown'
}

function extractSlideTitle(element: Element, index: number) {
  const heading = element.querySelector('h1, h2, h3, [data-slide-title]')?.textContent?.trim() ?? ''
  const dataTitle = element.getAttribute('data-title')?.trim() ?? ''
  const commentMatch = element.outerHTML.match(/<!--\s*slide:\s*([^>]+?)\s*-->/i)
  const commentTitle = commentMatch?.[1]?.trim() ?? ''

  return heading || dataTitle || commentTitle || `Slide ${index + 1}`
}

function extractSlideNotes(element: Element) {
  const asideNotes = element.querySelector('aside.notes')?.textContent?.replace(/\s+/g, ' ').trim()

  if (asideNotes) {
    return asideNotes
  }

  const dataNotes = element.getAttribute('data-notes')?.trim()

  if (dataNotes) {
    return dataNotes
  }

  const commentMatch = element.outerHTML.match(/<!--\s*notes:\s*([\s\S]*?)\s*-->/i)
  const commentNotes = commentMatch?.[1]?.replace(/\s+/g, ' ').trim()

  return commentNotes || null
}

function collectStyles(doc: Document): DeckStyleBlock[] {
  const styles: DeckStyleBlock[] = []

  doc.querySelectorAll('style').forEach((style, index) => {
    styles.push({
      index,
      inline: true,
      content: style.textContent ?? '',
    })
  })

  doc.querySelectorAll('link[rel="stylesheet"]').forEach((link, index) => {
    styles.push({
      index: doc.querySelectorAll('style').length + index,
      inline: false,
      href: link.getAttribute('href') ?? undefined,
      media: link.getAttribute('media') ?? undefined,
      content: '',
    })
  })

  return styles
}

function collectScripts(doc: Document): DeckScriptBlock[] {
  return [...doc.querySelectorAll('script')].map((script, index) => ({
    index,
    inline: !script.hasAttribute('src'),
    src: script.getAttribute('src') ?? undefined,
    type: script.getAttribute('type') ?? undefined,
    contentLength: (script.textContent ?? '').length,
  }))
}

function pushAsset(assets: DeckAssetReference[], seen: Set<string>, asset: DeckAssetReference) {
  const key = `${asset.kind}:${asset.url}:${asset.slideIndex ?? 'deck'}`

  if (seen.has(key)) {
    return
  }

  seen.add(key)
  assets.push(asset)
}

function collectAssets(doc: Document, slideElements: Element[]): DeckAssetReference[] {
  const assets: DeckAssetReference[] = []
  const seen = new Set<string>()

  const assetSelectors = [
    { selector: 'img[src]', kind: 'img' as const, attribute: 'src' },
    { selector: 'video[src]', kind: 'video' as const, attribute: 'src' },
    { selector: 'audio[src]', kind: 'audio' as const, attribute: 'src' },
    { selector: 'source[src]', kind: 'source' as const, attribute: 'src' },
    { selector: 'script[src]', kind: 'script' as const, attribute: 'src' },
    { selector: 'link[href]', kind: 'link' as const, attribute: 'href' },
  ]

  for (const { selector, kind, attribute } of assetSelectors) {
    for (const element of doc.querySelectorAll(selector)) {
      const url = element.getAttribute(attribute)?.trim()

      if (!url) {
        continue
      }

      const slideIndex = slideElements.findIndex((slide) => slide.contains(element))

      pushAsset(assets, seen, {
        kind,
        url,
        slideIndex: slideIndex >= 0 ? slideIndex : undefined,
      })
    }
  }

  for (const style of doc.querySelectorAll('style')) {
    const importMatches = style.textContent?.matchAll(/@import\s+url\((['"]?)([^)'"]+)\1\)/gi)

    if (!importMatches) {
      continue
    }

    for (const match of importMatches) {
      const url = match[2]?.trim()

      if (!url) {
        continue
      }

      pushAsset(assets, seen, {
        kind: 'import',
        url,
      })
    }
  }

  return assets.sort((a, b) => a.url.localeCompare(b.url))
}

const emptyParseResult: DeckParseResult = {
  title: 'Untitled deck',
  structure: 'unknown',
  runtime: {
    previewMode: 'css-only',
    arkDeck: null,
    arkPreview: null,
    arkRuntime: null,
    arkRuntimeLib: null,
    arkRuntimeVersion: null,
  },
  fonts: { display: null, body: null, mono: null },
  theme: null,
  slideSelector: null,
  slideCount: 0,
  slides: [],
  editableElements: [],
  styles: [],
  scripts: [],
  assets: [],
}

export type DeckParseOptions = {
  logger?: Logger
}

export function parseDeckHtml(html: string, options: DeckParseOptions = {}): DeckParseResult {
  if (!html.trim()) {
    return emptyParseResult
  }

  const { result, durationMs } = measureSync(() => parseDeckHtmlCore(html))

  if (options.logger) {
    logTimedEvent(options.logger, 'deck.parse.completed', durationMs, {
      htmlBytes: utf8ByteLength(html),
      slideCount: result.slideCount,
      structure: result.structure,
      scriptCount: result.scripts.length,
      assetCount: result.assets.length,
    })
  }

  return result
}

function parseDeckHtmlCore(html: string): DeckParseResult {
  const doc = new JSDOM(html).window.document
  const slideSelector = detectSlideSelector(doc)
  const slideElements = findSlideElements(doc)

  const slides = slideElements.map((element, index) => {
    const title = extractSlideTitle(element, index)
    const preview = element.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? ''
    const { slideId, slideIdTransient } = resolveSlideId(element, index)
    const recipe = readSlideRecipe(element)

    return {
      index,
      slideId,
      slideIdTransient,
      title,
      preview,
      outerHTML: element.outerHTML,
      notes: extractSlideNotes(element),
      kind: recipe.kind,
      layout: recipe.layout,
    }
  })

  return {
    title: extractDeckTitle(html),
    structure: detectDeckStructure(doc, slideSelector),
    runtime: readRuntimeMarkers(doc),
    fonts: readDeckFontSelection(doc),
    theme: readDeckThemeFromDocument(doc),
    slideSelector,
    slideCount: slides.length,
    slides,
    editableElements: parseEditableElements(slideElements, doc),
    styles: collectStyles(doc),
    scripts: collectScripts(doc),
    assets: collectAssets(doc, slideElements),
  }
}

export function summarizeParsedDeck(parsed: DeckParseResult) {
  if (parsed.slideCount === 0) {
    return `Deck "${parsed.title}" (${parsed.structure}). No slides detected; inspect raw HTML with read_deck.`
  }

  const slideList = parsed.slides
    .map((slide) => {
      const notesSuffix = slide.notes ? ' [notes]' : ''
      const kindSuffix = slide.kind ? ` [${slide.kind}]` : ''
      return `${slide.index}: ${slide.title}${kindSuffix}${notesSuffix}`
    })
    .join('; ')

  const parts = [
    `Deck "${parsed.title}"`,
    `${parsed.structure} structure`,
    `${parsed.slideCount} slide(s): ${slideList}`,
    `${parsed.styles.length} style block(s)`,
    `${parsed.scripts.length} script(s)`,
    `${parsed.assets.length} asset reference(s)`,
    `${parsed.runtime.previewMode} preview`,
  ]

  if (parsed.theme) {
    parts.push(`theme ${parsed.theme.signature}`)
  }

  if (parsed.slideSelector) {
    parts.push(`selector ${parsed.slideSelector}`)
  }

  const externalAssets = parsed.assets.filter((asset) => isExternalUrl(asset.url))

  if (externalAssets.length > 0) {
    parts.push(`${externalAssets.length} external URL(s)`)
  }

  return parts.join('. ') + '.'
}

export function toDeckSlideSummaries(parsed: DeckParseResult) {
  return parsed.slides.map(({ index, slideId, slideIdTransient, title, preview }) => ({
    index,
    slideId,
    slideIdTransient,
    title,
    preview,
  }))
}
