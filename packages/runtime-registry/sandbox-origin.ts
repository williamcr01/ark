import { getApprovedRuntimeAssetUrls } from './deck-runtime-registry.ts'

export const DEFAULT_APP_PORT = 5173
export const DEFAULT_SANDBOX_PORT = 5174
export const DEFAULT_API_PORT = 8787
export const OPAQUE_SANDBOX_ORIGIN = 'null'

export type SandboxOriginEnv = {
  ARK_APP_ORIGIN?: string
  ARK_SANDBOX_ORIGIN?: string
  ARK_API_ORIGIN?: string
  VITE_ARK_APP_ORIGIN?: string
  VITE_ARK_SANDBOX_ORIGIN?: string
  PORT?: string
  SANDBOX_PORT?: string
  VITE_DEV_PORT?: string
}

function trimOrigin(value: string | undefined) {
  const trimmed = value?.trim()

  return trimmed ? trimmed.replace(/\/+$/, '') : ''
}

function readRuntimeEnv(): SandboxOriginEnv {
  const env: SandboxOriginEnv = {}

  if (typeof process !== 'undefined' && process.env) {
    Object.assign(env, process.env)
  }

  if (typeof import.meta !== 'undefined' && 'env' in import.meta) {
    Object.assign(env, (import.meta as ImportMeta & { env: SandboxOriginEnv }).env)
  }

  return env
}

export function resolveAppOrigin(env: SandboxOriginEnv = readRuntimeEnv()): string {
  const configured =
    trimOrigin(env.ARK_APP_ORIGIN) ||
    trimOrigin(env.VITE_ARK_APP_ORIGIN) ||
    (typeof window !== 'undefined' ? trimOrigin(window.location.origin) : '')

  if (configured) {
    return configured
  }

  const port = env.VITE_DEV_PORT?.trim() || String(DEFAULT_APP_PORT)

  return `http://localhost:${port}`
}

export function resolveSandboxOrigin(env: SandboxOriginEnv = readRuntimeEnv()): string {
  const configured = trimOrigin(env.ARK_SANDBOX_ORIGIN) || trimOrigin(env.VITE_ARK_SANDBOX_ORIGIN)

  if (configured) {
    return configured
  }

  const port = env.SANDBOX_PORT?.trim() || String(DEFAULT_SANDBOX_PORT)

  return `http://localhost:${port}`
}

export function resolveApiOrigin(env: SandboxOriginEnv = readRuntimeEnv()): string {
  const configured = trimOrigin(env.ARK_API_ORIGIN)

  if (configured) {
    return configured
  }

  const port = env.PORT?.trim() || String(DEFAULT_API_PORT)

  return `http://localhost:${port}`
}

export function normalizeOrigin(origin: string) {
  return trimOrigin(origin)
}

function isLoopbackHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function expandLoopbackOrigin(origin: string) {
  const normalized = normalizeOrigin(origin)

  if (!normalized) {
    return []
  }

  try {
    const url = new URL(normalized)

    if (!isLoopbackHostname(url.hostname)) {
      return [normalized]
    }

    const port = url.port || (url.protocol === 'https:' ? '443' : '80')
    const protocol = url.protocol

    return [
      normalized,
      `${protocol}//localhost:${port}`,
      `${protocol}//127.0.0.1:${port}`,
      `${protocol}//[::1]:${port}`,
    ]
  } catch {
    return [normalized]
  }
}

export function originsMatch(left: string, right: string) {
  const leftCandidates = expandLoopbackOrigin(left)
  const rightCandidates = expandLoopbackOrigin(right)

  return leftCandidates.some((leftOrigin) => rightCandidates.includes(leftOrigin))
}

export function isOpaqueSandboxOrigin(origin: string) {
  return origin === OPAQUE_SANDBOX_ORIGIN
}

export function isAllowedSandboxOrigin(origin: string, expectedOrigin = resolveSandboxOrigin()) {
  if (isOpaqueSandboxOrigin(origin)) {
    return true
  }

  const normalized = normalizeOrigin(origin)

  if (!normalized) {
    return false
  }

  return originsMatch(normalized, expectedOrigin)
}

export function isAllowedBridgeMessageOrigin(
  origin: string,
  expectedSandboxOrigin: string | null = resolveSandboxOrigin(),
) {
  if (isOpaqueSandboxOrigin(origin)) {
    return true
  }

  if (!expectedSandboxOrigin) {
    return true
  }

  return isAllowedSandboxOrigin(origin, expectedSandboxOrigin)
}

export function isAllowedAppOrigin(origin: string, expectedOrigin = resolveAppOrigin()) {
  const normalized = normalizeOrigin(origin)

  if (!normalized) {
    return false
  }

  if (originsMatch(normalized, expectedOrigin)) {
    return true
  }

  // Vite falls back to 5175+ when 5173 is taken. The shell posts the real
  // window.location.origin as `parent=`; accept any loopback parent while the
  // configured app origin is also loopback so local preview can still arm.
  try {
    const actual = new URL(normalized)
    const expected = new URL(
      normalizeOrigin(expectedOrigin) || `http://localhost:${DEFAULT_APP_PORT}`,
    )

    return (
      isLoopbackHostname(actual.hostname) &&
      isLoopbackHostname(expected.hostname) &&
      actual.protocol === expected.protocol
    )
  } catch {
    return false
  }
}

export function buildSandboxRenderUrl(
  token: string,
  options: {
    sandboxOrigin?: string
    appOrigin?: string
  } = {},
) {
  const sandboxOrigin = options.sandboxOrigin ?? resolveSandboxOrigin()
  const appOrigin = options.appOrigin ?? resolveAppOrigin()
  const params = new URLSearchParams({ parent: appOrigin })

  return `${sandboxOrigin}/render/${encodeURIComponent(token)}?${params.toString()}`
}

export function buildSandboxFrameAncestorsCsp(appOrigin: string) {
  const ancestors = [...new Set(expandLoopbackOrigin(appOrigin))]

  if (ancestors.length === 0) {
    return "frame-ancestors 'none'"
  }

  return `frame-ancestors ${ancestors.join(' ')}`
}

function toAbsoluteSandboxAssetSource(source: string, appOrigin: string) {
  const origin = normalizeOrigin(appOrigin)

  if (!origin) {
    return null
  }

  try {
    return new URL(source, `${origin}/`).href
  } catch {
    return null
  }
}

function getSandboxRuntimeAssetSources(
  appOrigin: string,
  options: { kind: 'script' | 'stylesheet' | 'font' },
) {
  return getApprovedRuntimeAssetUrls({ kind: options.kind })
    .map((source) => toAbsoluteSandboxAssetSource(source, appOrigin))
    .filter((source): source is string => Boolean(source))
}

export type SandboxResponseCspOptions = {
  /**
   * Preview runtime mode. When `static` or `reveal` and a `nonce` is provided,
   * `script-src` drops `'unsafe-inline'` in favor of `'nonce-...'`. `custom-js`
   * (and the zero-options fallback) keep `'unsafe-inline'` for deck-authored
   * inline scripts.
   */
  runtimeMode?: 'static' | 'reveal' | 'custom-js'
  nonce?: string | null
}

export function buildSandboxResponseCsp(
  appOrigin: string,
  options: SandboxResponseCspOptions = {},
) {
  const normalizedAppOrigin = normalizeOrigin(appOrigin)
  const useNonce =
    Boolean(options.nonce) &&
    options.runtimeMode !== undefined &&
    options.runtimeMode !== 'custom-js'
  const scriptSources = [
    ...(useNonce && options.nonce ? [`'nonce-${options.nonce}'`] : ["'unsafe-inline'"]),
    ...getSandboxRuntimeAssetSources(appOrigin, { kind: 'script' }),
  ]
  const styleSources = [
    "'unsafe-inline'",
    ...getSandboxRuntimeAssetSources(appOrigin, { kind: 'stylesheet' }),
  ]
  const fontSources = ['data:', ...getSandboxRuntimeAssetSources(appOrigin, { kind: 'font' })]

  const imageSources = ['data:', 'blob:', ...(normalizedAppOrigin ? [normalizedAppOrigin] : [])]

  return `default-src 'none'; script-src ${scriptSources.join(' ')}; style-src ${styleSources.join(' ')}; img-src ${imageSources.join(' ')}; font-src ${fontSources.join(' ')}; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; manifest-src 'none'; ${buildSandboxFrameAncestorsCsp(appOrigin)}`
}

export const DECK_BRIDGE_POST_MESSAGE_TARGET = '*' as const
