import {
  findSlideElements,
  stripDeckScriptsForPreview,
  stripHostileNavigationVectors,
} from '@ark/deck-core/deck-preview-slides.ts'
import {
  createThumbnailSrcDocBuilder,
  type ThumbnailHtmlOptions,
} from '@ark/deck-core/deck-thumbnail-html.ts'
import { startRevealThumbnailStylesPreload } from '@ark/runtime-registry/runtime-stylesheet-content.ts'
import { detectRuntimeModeFromDocument } from './deck-runtime'

export { findSlideElements, stripDeckScriptsForPreview }

export type ParsedDeck = {
  slideCount: number
  slides: { index: number; outerHTML: string }[]
  headHtml: string
  htmlAttrs: string
  bodyAttrs: string
  /** Shared material whose changes can affect every fallback thumbnail. */
  thumbnailSharedKey: string
  getThumbnailSrcDoc: (index: number) => string
}

export type ParseDeckSlidesOptions = ThumbnailHtmlOptions

const INLINE_HANDLER_PATTERN = /^on[a-z]+$/i

function serializeElementAttrs(element: Element) {
  return [...element.attributes]
    .filter((attribute) => !INLINE_HANDLER_PATTERN.test(attribute.name))
    .map((attribute) => `${attribute.name}="${attribute.value.replace(/"/g, '&quot;')}"`)
    .join(' ')
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

function stripScripts(root: ParentNode) {
  root.querySelectorAll('script').forEach((script) => {
    script.remove()
  })
}

function stripScriptsFromHead(head: HTMLHeadElement) {
  const clone = head.cloneNode(true) as HTMLHeadElement

  stripScripts(clone)
  stripInlineHandlers(clone)

  return clone.innerHTML
}

function getThumbnailSharedKey(
  doc: Document,
  runtimeMode: ReturnType<typeof detectRuntimeModeFromDocument>,
  assetOrigin: string | null | undefined,
  deckId: string | null | undefined,
) {
  const root = doc.documentElement.cloneNode(true) as HTMLElement

  stripScripts(root)
  stripInlineHandlers(root)
  stripHostileNavigationVectors(root)

  const crossSlideInfluence = findSlideElements(root)
    .map((slide, index) => {
      const attributes = ['class', 'id', 'style']
        .map((name) => {
          const value = slide.getAttribute(name)
          return value ? `${name}=${value}` : ''
        })
        .filter(Boolean)
        .join('\0')
      const embeddedStyles = [...slide.querySelectorAll('style, link')]
        .map((node) => node.outerHTML)
        .join('')

      slide.replaceWith(doc.createComment(`ark-thumbnail-slide-${index}`))
      return `${index}:${attributes}:${embeddedStyles}`
    })
    .join('\n')

  return [runtimeMode, assetOrigin ?? '', deckId ?? '', root.outerHTML, crossSlideInfluence].join(
    '\0',
  )
}

const emptyParsedDeck: ParsedDeck = {
  slideCount: 0,
  slides: [],
  headHtml: '',
  htmlAttrs: '',
  bodyAttrs: '',
  thumbnailSharedKey: '',
  getThumbnailSrcDoc: () => '',
}

export function parseDeckSlideDocument(
  doc: Document,
  options: ParseDeckSlidesOptions = {},
): ParsedDeck {
  const slideElements = findSlideElements(doc)

  if (slideElements.length === 0) {
    return emptyParsedDeck
  }

  const head = doc.head
  const headHtml = head ? stripScriptsFromHead(head) : ''
  const htmlAttrs = doc.documentElement ? serializeElementAttrs(doc.documentElement) : ''
  const bodyAttrs = doc.body ? serializeElementAttrs(doc.body) : ''

  const slides = slideElements.map((element, index) => ({
    index,
    outerHTML: element.outerHTML,
  }))

  const runtimeMode = detectRuntimeModeFromDocument(doc)
  const thumbnailSharedKey = getThumbnailSharedKey(
    doc,
    runtimeMode,
    options.assetOrigin,
    options.deckId,
  )
  // Thumbnail srcDoc prep (reveal CSS inlining, etc.) is deferred until the
  // strip actually needs a fallback iframe — main preview/shell must not wait.
  let buildThumbnailSrcDoc: ((index: number) => string) | null = null

  return {
    slideCount: slides.length,
    slides,
    headHtml,
    htmlAttrs,
    bodyAttrs,
    thumbnailSharedKey,
    getThumbnailSrcDoc(index) {
      if (!Number.isInteger(index) || index < 0 || index >= slides.length) {
        return ''
      }

      if (!buildThumbnailSrcDoc) {
        startRevealThumbnailStylesPreload({ assetOrigin: options.assetOrigin })
        buildThumbnailSrcDoc = createThumbnailSrcDocBuilder(
          doc,
          htmlAttrs,
          bodyAttrs,
          runtimeMode,
          options,
        )
      }

      return buildThumbnailSrcDoc(index)
    },
  }
}

export function parseDeckSlides(html: string, options: ParseDeckSlidesOptions = {}): ParsedDeck {
  if (!html.trim()) {
    return emptyParsedDeck
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')

  return parseDeckSlideDocument(doc, options)
}
