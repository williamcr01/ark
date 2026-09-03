import type { ProviderId } from '@ark/contracts'

type ProviderOperationResult = { ok: true; modelCount?: number } | { ok: false; error: string }

export async function runProviderCredential(
  provider: ProviderId,
  operation: () => Promise<ProviderOperationResult>,
  successMessage: string,
  onBusy: (provider: ProviderId | null) => void,
  onMessage: (message: string) => void,
  refreshStatus: () => Promise<void>,
) {
  onBusy(provider)
  onMessage('')
  try {
    const result = await operation()
    if (!result.ok) {
      onMessage(result.error)
      return false
    }
    onMessage(
      result.modelCount === undefined
        ? successMessage
        : `${successMessage} ${result.modelCount} models are available.`,
    )
    await refreshStatus()
    return true
  } catch (error) {
    onMessage(error instanceof Error ? error.message : 'The operation failed.')
    return false
  } finally {
    onBusy(null)
  }
}
