import { JSDOM } from 'jsdom'

/**
 * JSDOM parses every inline `style="..."` through css-tree while constructing
 * the document (`HTMLElement`/`SVGElement` `_attrModified` → `style.cssText`).
 * Ark's editor apply path mutates styles via `getAttribute`/`setAttribute` and
 * almost never reads CSSOM, so that eager parse is wasted work on every
 * `move_element` of a 500-box slide.
 *
 * This helper stores the incoming cssText until a CSSOM read/write actually
 * happens (getComputedStyle, `.style.left`, setProperty, …). Unread siblings
 * keep their original attribute bytes through `serialize()`.
 *
 * The CSSStyleDeclaration *implementation* class is process-wide, so the lazy
 * setter is installed once. Call `createDeckJsdom` (or `installLazyInlineStyleParsing`)
 * before parsing deck HTML. Later `document.open/write/close` reuse on a pooled
 * window keeps the install. Parser / validation JSDOMs that never call this
 * helper stay on JSDOM's default eager parse.
 */

type JsdomOptions = Exclude<ConstructorParameters<typeof JSDOM>[1], undefined>
type JsdomWindow = JSDOM['window']

type StyleImpl = {
  cssText: string
  length: number
  getPropertyValue: (property: string) => string
  getPropertyPriority: (property: string) => string
  setProperty: (property: string, value: string, priority?: string) => void
  removeProperty: (property: string) => string
  item: (index: number) => string
}

const pendingCssText = new WeakMap<object, string>()
const flushing = new WeakSet<object>()

let installed = false

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

  throw new Error('Ark could not reach the jsdom implementation behind a style wrapper.')
}

function cssTextPrototype(styleImpl: object): StyleImpl {
  let proto: object | null = Object.getPrototypeOf(styleImpl)

  while (proto && proto !== Object.prototype) {
    if (Object.getOwnPropertyNames(proto).includes('cssText')) {
      return proto as StyleImpl
    }

    proto = Object.getPrototypeOf(proto)
  }

  throw new Error('Ark could not find jsdom CSSStyleDeclaration.cssText to defer.')
}

function flushPendingCssText(style: object, origSet: (value: string) => void) {
  const text = pendingCssText.get(style)

  if (text === undefined || flushing.has(style)) {
    return
  }

  pendingCssText.delete(style)
  flushing.add(style)

  try {
    origSet.call(style, text)
  } finally {
    flushing.delete(style)
  }
}

export function installLazyInlineStyleParsing(window: JsdomWindow): void {
  if (installed) {
    return
  }

  const probe = window.document.createElement('div').style
  const proto = cssTextPrototype(jsdomImpl(probe))
  const cssTextDesc = Object.getOwnPropertyDescriptor(proto, 'cssText')
  const origGet = cssTextDesc?.get
  const origSet = cssTextDesc?.set

  if (!origGet || !origSet) {
    throw new Error('jsdom CSSStyleDeclaration.cssText is not a getter/setter pair.')
  }

  Object.defineProperty(proto, 'cssText', {
    configurable: true,
    enumerable: cssTextDesc.enumerable,
    get() {
      if (pendingCssText.has(this)) {
        return pendingCssText.get(this)
      }

      return origGet.call(this)
    },
    set(value: string) {
      if (flushing.has(this)) {
        origSet.call(this, value)
        return
      }

      pendingCssText.set(this, String(value ?? ''))
    },
  })

  const wrap = <
    K extends
      'getPropertyValue' | 'getPropertyPriority' | 'setProperty' | 'removeProperty' | 'item',
  >(
    name: K,
  ) => {
    const orig = proto[name]

    proto[name] = function (this: object, ...args: never[]) {
      flushPendingCssText(this, origSet)
      return orig.apply(this, args)
    } as StyleImpl[K]
  }

  wrap('getPropertyValue')
  wrap('getPropertyPriority')
  wrap('setProperty')
  wrap('removeProperty')
  wrap('item')

  const lengthDesc = Object.getOwnPropertyDescriptor(proto, 'length')
  const origLength = lengthDesc?.get

  if (!origLength) {
    throw new Error('jsdom CSSStyleDeclaration.length is not a getter.')
  }

  Object.defineProperty(proto, 'length', {
    configurable: true,
    enumerable: lengthDesc.enumerable,
    get() {
      flushPendingCssText(this, origSet)
      return origLength.call(this)
    },
  })

  installed = true
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
