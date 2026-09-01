import { JSDOM } from 'jsdom'

import { PptxImportError, PPTX_INVALID_MESSAGE } from './errors.ts'

export function parseXml(xml: string): Document {
  try {
    const dom = new JSDOM(xml, { contentType: 'application/xml' })
    const doc = dom.window.document
    if (doc.getElementsByTagName('parsererror').length > 0) {
      throw new PptxImportError(PPTX_INVALID_MESSAGE, 'pptx_invalid')
    }
    return doc
  } catch (error) {
    if (error instanceof PptxImportError) throw error
    throw new PptxImportError(PPTX_INVALID_MESSAGE, 'pptx_invalid')
  }
}

export function localName(node: Element) {
  return node.localName || node.tagName.replace(/^.*:/, '')
}

export function childrenByLocalName(parent: Element | Document, name: string): Element[] {
  const root =
    'documentElement' in parent && parent.documentElement ? parent.documentElement : parent
  if (!('getElementsByTagName' in root)) return []
  return [...(root as Element).getElementsByTagName('*')].filter((el) => localName(el) === name)
}

export function directChildren(parent: Element, name: string): Element[] {
  return [...parent.children].filter((el) => localName(el) === name)
}

export function firstChild(parent: Element | Document | null | undefined, name: string) {
  if (!parent) return null
  if ('children' in parent) {
    return [...parent.children].find((el) => localName(el) === name) ?? null
  }
  const documentElement = (parent as Document).documentElement
  return documentElement && localName(documentElement) === name ? documentElement : null
}

export function descendant(parent: Element | Document | null | undefined, name: string) {
  if (!parent) return null
  return childrenByLocalName(parent, name)[0] ?? null
}

export function attr(el: Element | null | undefined, name: string) {
  if (!el) return null
  return (
    el.getAttribute(name) ??
    el.getAttribute(name.includes(':') ? name.slice(name.indexOf(':') + 1) : name) ??
    null
  )
}

export function attrNS(el: Element | null | undefined, local: string) {
  if (!el) return null
  for (const attribute of el.attributes) {
    if (
      attribute.localName === local ||
      attribute.name === local ||
      attribute.name.endsWith(`:${local}`)
    ) {
      return attribute.value
    }
  }
  return null
}

export function textContent(el: Element | null | undefined) {
  return el?.textContent?.replace(/\s+/g, ' ').trim() || ''
}

const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export function rId(el: Element | null | undefined) {
  if (!el) return null
  return (
    el.getAttribute('r:id') ??
    el.getAttributeNS(OFFICE_REL_NS, 'id') ??
    [...el.attributes].find((attribute) => attribute.prefix === 'r' && attribute.localName === 'id')
      ?.value ??
    null
  )
}
