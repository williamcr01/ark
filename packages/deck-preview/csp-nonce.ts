/**
 * Generate a cryptographically random CSP nonce.
 * Works in both browser and Node (globalThis.crypto).
 */
export function generateCspNonce(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength)
  globalThis.crypto.getRandomValues(bytes)

  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  // base64url-ish without padding — safe inside CSP 'nonce-...' tokens and HTML attributes
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function formatCspNonceSource(nonce: string): string {
  return `'nonce-${nonce}'`
}
