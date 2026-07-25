import type { PreviewBridgeCompromiseReason } from '@/hooks/usePreviewBridgeSession'

export function previewCompromiseCopy(reason: PreviewBridgeCompromiseReason | null | undefined) {
  switch (reason) {
    case 'handshake-timeout':
    case 'missing-handshake':
      return {
        title: 'Preview stopped',
        body: 'The preview frame loaded but never completed its security handshake with Ark. This often happens when the app is opened on a different port than expected. Reload the deck, or restart `pnpm dev` with port 5173 free.',
      }
    case 'invalid-handshake':
      return {
        title: 'Preview stopped',
        body: 'The preview frame sent an invalid security handshake. Reload the deck to restore the preview.',
      }
    case 'unexpected-load':
    default:
      return {
        title: 'Preview stopped',
        body: 'The deck attempted an unexpected navigation. Preview was torn down to stop further bridge messages from reaching an untrusted page. Edit or reload the deck to restore the preview.',
      }
  }
}
