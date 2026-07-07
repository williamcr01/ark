import {
  isApprovedRuntimeAssetUrl,
  parseRuntimeAssetUrl,
  resolveDeckApprovedRuntime,
} from '@ark/runtime-registry/deck-runtime-registry.ts'
import { findSlideElements } from './deck-preview-slides.ts'
import {
  findRevealSlidesContainer,
  hasRevealSlideStructure,
  revealLinearIndexToHV,
} from './reveal-slide-index.ts'
import {
  injectRuntimeCsp,
  STRICT_DECK_CSP,
  type DeckRuntimeMode,
} from '@ark/runtime-registry/deck-runtime.ts'
import { getApprovedRuntimeStylesheetContent } from '@ark/runtime-registry/runtime-stylesheet-content.ts'

const INLINE_HANDLER_PATTERN = /^on[a-z]+$/i

export const revealThumbnailLayoutShim = `
<style data-ark-reveal-thumb-shim>
  .reveal.ark-thumbnail-ready {
    width: 100% !important;
    height: 100% !important;
    font-family: Helvetica, Arial, sans-serif;
  }

  .reveal.ark-thumbnail-ready .slides {
    width: 100% !important;
    height: 100% !important;
    transform: none !important;
    top: 0 !important;
    left: 0 !important;
    margin: 0 !important;
  }

  .reveal.ark-thumbnail-ready .slides > section.present,
  .reveal.ark-thumbnail-ready .slides > section > section.present {
    display: flex !important;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    position: absolute !important;
    width: 100% !important;
    height: 100% !important;
    top: 0 !important;
    left: 0 !important;
    margin: 0 !important;
    transform: none !important;
    opacity: 1 !important;
    visibility: visible !important;
    pointer-events: auto !important;
  }

  .reveal.ark-thumbnail-ready .slides > section.stack {
    display: block !important;
    position: absolute !important;
    width: 100% !important;
    height: 100% !important;
    top: 0 !important;
    left: 0 !important;
    transform: none !important;
    opacity: 1 !important;
    visibility: visible !important;
  }

  .reveal.ark-thumbnail-ready .slides > section:not(.present):not(.stack),
  .reveal.ark-thumbnail-ready .slides > section > section:not(.present) {
    display: none !important;
  }

  .reveal.ark-thumbnail-ready .fragment {
    opacity: 1 !important;
    visibility: visible !important;
    transform: none !important;
  }
</style>`

export const thumbnailFillStyle = `
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

export type ThumbnailHtmlOptions = {
  assetOrigin?: string | null
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

function resolveRelativeAssetPath(basePath: string, relativePath: string) {
  const baseSegments = basePath.split('/').filter(Boolean)
  const relativeSegments = relativePath.split('/')

  for (const segment of relativeSegments) {
    if (segment === '.') {
      continue
    }

    if (segment === '..') {
      baseSegments.pop()
      continue
    }

    baseSegments.push(segment)
  }

  return baseSegments.join('/')
}

function stripFontFaceRules(css: string) {
  return css.replace(/@font-face\s*\{[^}]*\}/g, '')
}

function expandStylesheetImports(
  css: string,
  basePath: string,
  runtimeId: string,
  version: string,
): string {
  return css.replace(
    /@import\s+url\((['"]?)([^'")]+)\1\)\s*;?/g,
    (_match, _quote, importPath: string) => {
      const resolvedPath = resolveRelativeAssetPath(
        basePath.split('/').slice(0, -1).join('/'),
        importPath,
      )
      const imported = getApprovedRuntimeStylesheetContent(runtimeId, version, resolvedPath)

      if (!imported) {
        return ''
      }

      return expandStylesheetImports(imported, resolvedPath, runtimeId, version)
    },
  )
}

function inlineApprovedRuntimeStylesheet(
  runtimeId: string,
  version: string,
  assetPath: string,
): string | null {
  const css = getApprovedRuntimeStylesheetContent(runtimeId, version, assetPath)

  if (!css) {
    return null
  }

  const expanded = expandStylesheetImports(css, assetPath, runtimeId, version)

  return stripFontFaceRules(expanded)
}

function markRevealThumbnailSlide(slide: Element, options: { isStackParent?: boolean } = {}) {
  if (!options.isStackParent) {
    slide.classList.add('active', 'is-active', 'present')
    slide.classList.remove('past', 'future')
    slide.setAttribute('aria-hidden', 'false')
    slide.setAttribute('data-active', '')
    slide.removeAttribute('data-ark-hidden')

    slide.querySelectorAll('.fragment').forEach((fragment) => {
      fragment.classList.add('visible')
    })

    return
  }

  slide.classList.add('stack', 'present')
  slide.setAttribute('aria-hidden', 'false')
}

function preparePlainThumbnailBody(bodyClone: HTMLBodyElement, slideIndex: number) {
  const slides = findSlideElements(bodyClone)

  slides.forEach((slide, index) => {
    if (index !== slideIndex) {
      slide.remove()
      return
    }

    slide.classList.add('active', 'is-active', 'present')
    slide.setAttribute('aria-hidden', 'false')
    slide.setAttribute('data-active', '')
    slide.removeAttribute('data-ark-hidden')
  })
}

export function prepareRevealThumbnailBody(doc: Document, linearIndex: number) {
  const bodyClone = doc.body.cloneNode(true) as HTMLBodyElement

  stripScripts(bodyClone)
  stripInlineHandlers(bodyClone)

  const slidesContainer = findRevealSlidesContainer(bodyClone)

  if (!slidesContainer) {
    preparePlainThumbnailBody(bodyClone, linearIndex)
    return bodyClone.innerHTML
  }

  const hv = revealLinearIndexToHV(slidesContainer, linearIndex)

  if (!hv) {
    return bodyClone.innerHTML
  }

  const horizontalSections = [...slidesContainer.querySelectorAll(':scope > section')]

  for (const [h, horizontal] of horizontalSections.entries()) {
    if (h !== hv.h) {
      horizontal.remove()
      continue
    }

    const verticalSections = [...horizontal.querySelectorAll(':scope > section')]

    if (verticalSections.length > 0) {
      for (const [v, vertical] of verticalSections.entries()) {
        if (v !== hv.v) {
          vertical.remove()
          continue
        }

        markRevealThumbnailSlide(vertical)
      }

      markRevealThumbnailSlide(horizontal, { isStackParent: true })
      continue
    }

    markRevealThumbnailSlide(horizontal)
  }

  bodyClone.querySelector('.reveal')?.classList.add('ark-thumbnail-ready')

  return bodyClone.innerHTML
}

export function prepareThumbnailBody(
  doc: Document,
  slideIndex: number,
  runtimeMode: DeckRuntimeMode,
) {
  if (runtimeMode === 'reveal' && hasRevealSlideStructure(doc)) {
    return prepareRevealThumbnailBody(doc, slideIndex)
  }

  const bodyClone = doc.body.cloneNode(true) as HTMLBodyElement

  stripScripts(bodyClone)
  stripInlineHandlers(bodyClone)
  preparePlainThumbnailBody(bodyClone, slideIndex)

  return bodyClone.innerHTML
}

export function prepareThumbnailHeadHtml(
  doc: Document,
  runtimeMode: DeckRuntimeMode,
  _options: ThumbnailHtmlOptions = {},
) {
  const head = doc.head

  if (!head) {
    return { headHtml: '', usesInlinedRuntimeCss: false }
  }

  const headClone = head.cloneNode(true) as HTMLHeadElement

  stripScripts(headClone)
  stripInlineHandlers(headClone)

  const approvedRuntime = runtimeMode === 'reveal' ? resolveDeckApprovedRuntime(doc) : null
  let usesInlinedRuntimeCss = false

  if (approvedRuntime) {
    const inlinedStyles: string[] = []
    const seenAssets = new Set<string>()
    const approvedLinks = [...headClone.querySelectorAll('link[rel="stylesheet"]')].filter(
      (link) => {
        const href = link.getAttribute('href')

        return Boolean(href && isApprovedRuntimeAssetUrl(href, 'stylesheet'))
      },
    )
    let allApprovedLinksInlined = approvedLinks.length > 0

    for (const link of approvedLinks) {
      const href = link.getAttribute('href')

      if (!href) {
        allApprovedLinksInlined = false
        continue
      }

      const ref = parseRuntimeAssetUrl(href)

      if (!ref) {
        allApprovedLinksInlined = false
        continue
      }

      if (seenAssets.has(ref.assetPath)) {
        link.remove()
        continue
      }

      seenAssets.add(ref.assetPath)

      const css = inlineApprovedRuntimeStylesheet(ref.runtimeId, ref.version, ref.assetPath)

      if (!css) {
        allApprovedLinksInlined = false
        continue
      }

      link.remove()
      inlinedStyles.push(
        `<style data-ark-runtime-css="${ref.runtimeId}@${ref.version}/${ref.assetPath}">\n${css}\n</style>`,
      )
    }

    if (inlinedStyles.length > 0) {
      headClone.insertAdjacentHTML('beforeend', inlinedStyles.join('\n'))
    }

    usesInlinedRuntimeCss = allApprovedLinksInlined
  }

  return {
    headHtml: headClone.innerHTML,
    usesInlinedRuntimeCss,
  }
}

export function buildThumbnailSrcDoc(
  doc: Document,
  slideIndex: number,
  htmlAttrs: string,
  bodyAttrs: string,
  runtimeMode: DeckRuntimeMode,
  options: ThumbnailHtmlOptions = {},
) {
  const { headHtml, usesInlinedRuntimeCss } = prepareThumbnailHeadHtml(doc, runtimeMode, options)
  const bodyHtml = prepareThumbnailBody(doc, slideIndex, runtimeMode)
  const revealShim =
    runtimeMode === 'reveal' && hasRevealSlideStructure(doc) ? revealThumbnailLayoutShim : ''
  const htmlOpen = htmlAttrs ? `<html ${htmlAttrs}>` : '<html>'
  const bodyOpen = bodyAttrs ? `<body ${bodyAttrs}>` : '<body>'
  const srcDoc = `<!DOCTYPE html>
${htmlOpen}
<head>
${headHtml}
${thumbnailFillStyle}
${revealShim}
</head>
${bodyOpen}
${bodyHtml}
</body>
</html>`

  if (usesInlinedRuntimeCss) {
    return injectRuntimeCsp(srcDoc, 'static')
  }

  return injectRuntimeCsp(srcDoc, runtimeMode, { assetOrigin: options.assetOrigin })
}

export function thumbnailUsesStrictCsp(srcDoc: string) {
  return srcDoc.includes(STRICT_DECK_CSP)
}

export function thumbnailPreservesRevealWrapper(srcDoc: string) {
  const doc = new DOMParser().parseFromString(srcDoc, 'text/html')

  return Boolean(doc.querySelector('.reveal .slides section'))
}
