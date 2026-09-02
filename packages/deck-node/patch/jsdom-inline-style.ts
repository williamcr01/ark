import { JSDOM } from 'jsdom'

/**
 * JSDOM parses every inline `style="..."` through css-tree while constructing
 * the document (`HTMLElement`/`SVGElement` `_attrModified` → `style.cssText`).
 * Ark's editor apply path mutates styles via `getAttribute`/`setAttribute` and
 * almost never reads CSSOM, so that eager parse is wasted work on every
 * `move_element` of a 500-box slide.
 *
 * Laziness is installed at the element boundary, scoped to documents created
 * through this helper:
 *
 * - `_attrModified` stores the style attribute until CSSOM is used.
 * - The impl `style` getter flushes with `_settingCssText = true` so the flush
 *   cannot rewrite the attribute (named setters, `style[0]`, `getComputedStyle`
 *   all go through that getter).
 * - Parser / validation `new JSDOM()` documents stay on eager parse.
 *
 * Internals are jsdom 29.1.1 private API. If they are missing, we warn once and
 * fall back to eager `new JSDOM` — never throw from `beforeParse`.
 */

type JsdomOptions = Exclude<ConstructorParameters<typeof JSDOM>[1], undefined>
type JsdomWindow = JSDOM['window']

type StyleDeclaration = { cssText: string }

type ElementImpl = {
  _settingCssText?: boolean
  _ownerDocument?: object
  style?: StyleDeclaration
  _attrModified?: (name: string, value: unknown, oldValue: unknown) => void
  _initElementCSSInlineStyle?: () => void
}

const SVG_NS = 'http://www.w3.org/2000/svg'

const lazyDocuments = new WeakSet<object>()
const pendingStyle = new WeakMap<object, string>()
const styleSlots = new WeakMap<object, StyleDeclaration>()

let hooksInstalled = false
let hooksFailed = false
let installWarned = false

function warnInstallFailure(error: unknown) {
  if (installWarned) {
    return
  }

  installWarned = true
  console.warn(
    'Ark could not install lazy JSDOM inline-style parsing; using eager css-tree parse.',
    error,
  )
}

function jsdomImpl(wrapper: object): object {
  for (const key of Reflect.ownKeys(wrapper)) {
    if (typeof key !== 'symbol' || key.description !== 'impl') {
      continue
    }

    const value = Reflect.get(wrapper, key)

    if (value && typeof value === 'object') {
      return value as object
    }
  }

  throw new Error('Ark could not reach the jsdom implementation behind a wrapper.')
}

function prototypeOwning(object: object, name: string): ElementImpl | null {
  let proto: object | null = Object.getPrototypeOf(object)

  while (proto && proto !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(proto, name)) {
      return proto as ElementImpl
    }

    proto = Object.getPrototypeOf(proto)
  }

  return null
}

function isLazyDocument(docImpl: object | undefined) {
  return Boolean(docImpl && lazyDocuments.has(docImpl))
}

function flushPendingStyle(elementImpl: ElementImpl) {
  if (!pendingStyle.has(elementImpl)) {
    return
  }

  const text = pendingStyle.get(elementImpl) ?? ''
  pendingStyle.delete(elementImpl)
  const declaration = styleSlots.get(elementImpl)

  if (!declaration) {
    return
  }

  elementImpl._settingCssText = true

  try {
    declaration.cssText = text
  } finally {
    elementImpl._settingCssText = false
  }
}

function defineStyleAccessor(proto: ElementImpl) {
  const existing = Object.getOwnPropertyDescriptor(proto, 'style')

  if (existing?.get && existing.set) {
    return
  }

  Object.defineProperty(proto, 'style', {
    configurable: true,
    enumerable: true,
    get() {
      flushPendingStyle(this as ElementImpl)
      return styleSlots.get(this as object)
    },
    set(value: StyleDeclaration) {
      styleSlots.set(this as object, value)
    },
  })
}

function wrapInit(proto: ElementImpl) {
  const orig = proto._initElementCSSInlineStyle

  if (typeof orig !== 'function') {
    throw new Error('jsdom _initElementCSSInlineStyle is missing.')
  }

  proto._initElementCSSInlineStyle = function (this: ElementImpl) {
    orig.call(this)

    if (!isLazyDocument(this._ownerDocument)) {
      return
    }

    const declaration = this.style

    if (declaration) {
      styleSlots.set(this, declaration)
    }

    Reflect.deleteProperty(this, 'style')
  }
}

function wrapAttrModified(proto: ElementImpl) {
  const orig = proto._attrModified

  if (typeof orig !== 'function') {
    throw new Error('jsdom _attrModified is missing.')
  }

  proto._attrModified = function (this: ElementImpl, name, value, oldValue) {
    if (
      name === 'style' &&
      value !== oldValue &&
      !this._settingCssText &&
      isLazyDocument(this._ownerDocument)
    ) {
      pendingStyle.set(this, value == null ? '' : String(value))
      this._settingCssText = true

      try {
        orig.call(this, name, value, oldValue)
      } finally {
        this._settingCssText = false
      }

      return
    }

    orig.call(this, name, value, oldValue)
  }
}

function installOnElementPrototype(probeImpl: object) {
  const attrProto = prototypeOwning(probeImpl, '_attrModified')
  const initProto = prototypeOwning(probeImpl, '_initElementCSSInlineStyle')

  if (!attrProto || !initProto) {
    throw new Error('jsdom HTML/SVG element prototypes are missing style hooks.')
  }

  wrapAttrModified(attrProto)
  wrapInit(initProto)
  defineStyleAccessor(initProto)
}

function installHooks(window: JsdomWindow) {
  if (hooksInstalled || hooksFailed) {
    return
  }

  try {
    const htmlProbe = window.document.createElement('div')
    installOnElementPrototype(jsdomImpl(htmlProbe))

    const svgProbe = window.document.createElementNS(SVG_NS, 'g')
    installOnElementPrototype(jsdomImpl(svgProbe))
    hooksInstalled = true
  } catch (error) {
    hooksFailed = true
    warnInstallFailure(error)
  }
}

function tagLazyDocument(window: JsdomWindow) {
  try {
    lazyDocuments.add(jsdomImpl(window.document))
  } catch (error) {
    warnInstallFailure(error)
  }
}

/**
 * Install per-document lazy inline-style parsing on this window and tag its
 * document. Safe to call more than once (pooled `document.write` reuse).
 * Returns whether the document was tagged for lazy parsing.
 */
export function installLazyInlineStyleParsing(window: JsdomWindow): boolean {
  if (hooksFailed) {
    return false
  }

  installHooks(window)

  if (hooksFailed || !hooksInstalled) {
    return false
  }

  tagLazyDocument(window)
  return true
}

export function createDeckJsdom(html: string, options: JsdomOptions = {}): JSDOM {
  const userBeforeParse = options.beforeParse

  return new JSDOM(html, {
    ...options,
    beforeParse(window) {
      installLazyInlineStyleParsing(window)
      userBeforeParse?.(window)
    },
  })
}
