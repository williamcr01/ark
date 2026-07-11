import {
  findSlideElements,
  SLIDE_SELECTOR_CHAIN,
  stripDeckScriptsForPreview,
} from '@ark/deck-core/deck-preview-slides.ts'
import {
  createThumbnailSrcDocBuilder,
  type ThumbnailHtmlOptions,
} from '@ark/deck-core/deck-thumbnail-html.ts'
import { startRevealThumbnailStylesPreload } from '@ark/runtime-registry/runtime-stylesheet-content.ts'
import { detectRuntimeModeFromDocument } from './deck-runtime'

export { SLIDE_SELECTOR_CHAIN, findSlideElements, stripDeckScriptsForPreview }

export type ParsedDeck = {
  slideCount: number
  slides: { index: number; outerHTML: string }[]
  headHtml: string
  htmlAttrs: string
  bodyAttrs: string
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

const emptyParsedDeck: ParsedDeck = {
  slideCount: 0,
  slides: [],
  headHtml: '',
  htmlAttrs: '',
  bodyAttrs: '',
  getThumbnailSrcDoc: () => '',
}

export function parseDeckSlideDocument(
  doc: Document,
  options: ParseDeckSlidesOptions = {},
): ParsedDeck {
  startRevealThumbnailStylesPreload({ assetOrigin: options.assetOrigin })

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
  const buildThumbnailSrcDoc = createThumbnailSrcDocBuilder(
    doc,
    htmlAttrs,
    bodyAttrs,
    runtimeMode,
    options,
  )

  return {
    slideCount: slides.length,
    slides,
    headHtml,
    htmlAttrs,
    bodyAttrs,
    getThumbnailSrcDoc(index) {
      if (!Number.isInteger(index) || index < 0 || index >= slides.length) {
        return ''
      }

      return buildThumbnailSrcDoc(index)
    },
  }
}

export function parseDeckSlides(html: string, options: ParseDeckSlidesOptions = {}): ParsedDeck {
  if (!html.trim()) {
    startRevealThumbnailStylesPreload({ assetOrigin: options.assetOrigin })
    return emptyParsedDeck
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')

  return parseDeckSlideDocument(doc, options)
}
