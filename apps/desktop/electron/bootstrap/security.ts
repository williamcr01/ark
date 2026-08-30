/**
 * Network lockdown for the renderer. CSP cannot stop a sandboxed frame navigating itself,
 * so the session request filter cancels anything outside Ark's exact loopback origins
 * before it reaches the network.
 */

import { session, type WebContents } from 'electron'

export function hasAllowedOrigin(rawUrl: string, allowedOrigins: ReadonlySet<string>) {
  try {
    const url = new URL(rawUrl)
    return allowedOrigins.has(url.origin)
  } catch {
    return false
  }
}

export function lockRendererNetwork(webContents: WebContents, rendererOrigin: string) {
  const allowedOrigins = new Set([rendererOrigin])
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // This event covers the main renderer frame only. Subframe requests and navigations are
  // intentionally enforced by the session-wide webRequest filter below; keep both layers.
  webContents.on('will-navigate', (event, url) => {
    if (!hasAllowedOrigin(url, allowedOrigins)) event.preventDefault()
  })
  webContents.on('will-attach-webview', (event) => event.preventDefault())
}

export function configureSessionSecurity(allowedOrigins: ReadonlySet<string>) {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const url = new URL(details.url)
      const allowed =
        ['data:', 'blob:', 'devtools:'].includes(url.protocol) ||
        (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) &&
          allowedOrigins.has(url.origin.replace(/^ws/, 'http')))
      callback({ cancel: !allowed })
    } catch {
      callback({ cancel: true })
    }
  })
}
