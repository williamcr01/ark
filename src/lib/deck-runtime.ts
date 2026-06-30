export type DeckRuntimeMode = 'static' | 'reveal' | 'custom-js'

export type DeckRuntimePolicy = {
  mode: DeckRuntimeMode
  csp: string
  previewSandbox: string
  thumbnailSandbox: string
  allowsDeckScripts: boolean
}

const PREVIEW_SANDBOX = 'allow-scripts'
const THUMBNAIL_SANDBOX = ''

const BLOCKED_SANDBOX_FEATURES = [
  'allow-same-origin',
  'allow-forms',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
  'allow-modals',
  'allow-pointer-lock',
  'allow-presentation',
] as const

const STRICT_CSP_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "child-src 'none'",
  "manifest-src 'none'",
] as const

export const STRICT_DECK_CSP = STRICT_CSP_DIRECTIVES.join('; ')

function hasCustomJsMarker(doc: Document) {
  for (const element of [doc.documentElement, doc.body]) {
    if (!element) {
      continue
    }

    if (element.getAttribute('data-ark-deck') === 'nav') {
      return true
    }

    if (element.getAttribute('data-ark-preview') === 'full-js') {
      return true
    }

    if (element.getAttribute('data-ark-runtime') === 'custom-js') {
      return true
    }
  }

  return false
}

function hasRevealMarker(doc: Document) {
  for (const element of [doc.documentElement, doc.body]) {
    if (!element) {
      continue
    }

    if (element.getAttribute('data-ark-runtime') === 'reveal') {
      return true
    }

    if (element.getAttribute('data-ark-deck') === 'reveal') {
      return true
    }
  }

  return false
}

function hasRevealStructure(doc: Document) {
  const revealRoot = doc.querySelector('.reveal .slides')

  if (!revealRoot) {
    return false
  }

  return revealRoot.querySelector('section') !== null
}

export function detectRuntimeModeFromDocument(doc: Document): DeckRuntimeMode {
  if (hasCustomJsMarker(doc)) {
    return 'custom-js'
  }

  if (hasRevealMarker(doc) || hasRevealStructure(doc)) {
    return 'reveal'
  }

  return 'static'
}

export function detectRuntimeMode(html: string): DeckRuntimeMode {
  if (!html.trim()) {
    return 'static'
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')

  return detectRuntimeModeFromDocument(doc)
}

export function runtimeModeAllowsDeckScripts(mode: DeckRuntimeMode) {
  return mode === 'custom-js'
}

export function runtimeModeToBridgePreviewMode(
  mode: DeckRuntimeMode,
): 'css-only' | 'full-js' {
  return mode === 'custom-js' ? 'full-js' : 'css-only'
}

export function getRuntimePolicy(mode: DeckRuntimeMode): DeckRuntimePolicy {
  return {
    mode,
    csp: STRICT_DECK_CSP,
    previewSandbox: PREVIEW_SANDBOX,
    thumbnailSandbox: THUMBNAIL_SANDBOX,
    allowsDeckScripts: runtimeModeAllowsDeckScripts(mode),
  }
}

export function getPreviewSandbox(mode: DeckRuntimeMode) {
  return getRuntimePolicy(mode).previewSandbox
}

export function getThumbnailSandbox() {
  return THUMBNAIL_SANDBOX
}

export function getRuntimeCsp(mode: DeckRuntimeMode) {
  return getRuntimePolicy(mode).csp
}

export function getBlockedSandboxFeatures() {
  return [...BLOCKED_SANDBOX_FEATURES]
}

function escapeCspForMetaAttribute(csp: string) {
  return csp.replace(/"/g, '&quot;')
}

export function buildCspMetaTag(csp: string) {
  return `<meta http-equiv="Content-Security-Policy" content="${escapeCspForMetaAttribute(csp)}">`
}

export function injectRuntimeCsp(html: string, mode: DeckRuntimeMode) {
  if (!html.trim()) {
    return html
  }

  const meta = buildCspMetaTag(getRuntimeCsp(mode))

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}\n${meta}`)
  }

  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (match) => `${match}\n<head>\n${meta}\n</head>`)
  }

  return `<head>\n${meta}\n</head>\n${html}`
}
