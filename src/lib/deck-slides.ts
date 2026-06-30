import {
  detectRuntimeModeFromDocument,
  injectRuntimeCsp,
  type DeckRuntimeMode,
} from './deck-runtime'

export const SLIDE_SELECTOR_CHAIN = [
  'section.slide',
  'body > section',
  '.slides > section',
  '.reveal .slides > section',
  'main > section',
] as const

export type ParsedDeck = {
  slideCount: number
  slides: { index: number; outerHTML: string }[]
  headHtml: string
  htmlAttrs: string
  bodyAttrs: string
  thumbnailSrcDocs: string[]
}

const INLINE_HANDLER_PATTERN = /^on[a-z]+$/i

const thumbnailFillStyle = `
<style data-ark-thumb-fill>
  html,
  body {
    width: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
  }
</style>`

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

export function stripDeckScriptsForPreview(html: string): string {
  if (!html.trim()) {
    return ''
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')

  if (doc.head) {
    stripScripts(doc.head)
    stripInlineHandlers(doc.head)
  }

  if (doc.body) {
    stripScripts(doc.body)
    stripInlineHandlers(doc.body)
  }

  const htmlAttrs = doc.documentElement ? serializeElementAttrs(doc.documentElement) : ''
  const bodyAttrs = doc.body ? serializeElementAttrs(doc.body) : ''
  const headHtml = doc.head?.innerHTML ?? ''
  const bodyHtml = doc.body?.innerHTML ?? ''
  const htmlOpen = htmlAttrs ? `<html ${htmlAttrs}>` : '<html>'
  const bodyOpen = bodyAttrs ? `<body ${bodyAttrs}>` : '<body>'

  return `<!DOCTYPE html>
${htmlOpen}
<head>
${headHtml}
</head>
${bodyOpen}
${bodyHtml}
</body>
</html>`
}

export function findSlideElements(root: ParentNode) {
  for (const selector of SLIDE_SELECTOR_CHAIN) {
    const slides = [...root.querySelectorAll(selector)]

    if (slides.length > 0) {
      return slides
    }
  }

  return []
}

function prepareThumbnailBody(doc: Document, slideIndex: number) {
  const bodyClone = doc.body.cloneNode(true) as HTMLBodyElement

  stripScripts(bodyClone)
  stripInlineHandlers(bodyClone)

  const slides = findSlideElements(bodyClone)

  slides.forEach((slide, index) => {
    if (index !== slideIndex) {
      slide.remove()
      return
    }

    slide.classList.add('active', 'is-active')
    slide.setAttribute('aria-hidden', 'false')
    slide.setAttribute('data-active', '')
    slide.removeAttribute('data-ark-hidden')
  })

  return bodyClone.innerHTML
}

function buildThumbnailSrcDoc(
  doc: Document,
  slideIndex: number,
  headHtml: string,
  htmlAttrs: string,
  bodyAttrs: string,
  runtimeMode: DeckRuntimeMode,
) {
  const bodyHtml = prepareThumbnailBody(doc, slideIndex)
  const htmlOpen = htmlAttrs ? `<html ${htmlAttrs}>` : '<html>'
  const bodyOpen = bodyAttrs ? `<body ${bodyAttrs}>` : '<body>'
  const srcDoc = `<!DOCTYPE html>
${htmlOpen}
<head>
${headHtml}
${thumbnailFillStyle}
</head>
${bodyOpen}
${bodyHtml}
</body>
</html>`

  return injectRuntimeCsp(srcDoc, runtimeMode)
}

const emptyParsedDeck: ParsedDeck = {
  slideCount: 0,
  slides: [],
  headHtml: '',
  htmlAttrs: '',
  bodyAttrs: '',
  thumbnailSrcDocs: [],
}

export function parseDeckSlides(html: string): ParsedDeck {
  if (!html.trim()) {
    return emptyParsedDeck
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')
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

  const thumbnailSrcDocs = slides.map((slide) =>
    buildThumbnailSrcDoc(doc, slide.index, headHtml, htmlAttrs, bodyAttrs, runtimeMode),
  )

  return {
    slideCount: slides.length,
    slides,
    headHtml,
    htmlAttrs,
    bodyAttrs,
    thumbnailSrcDocs,
  }
}
