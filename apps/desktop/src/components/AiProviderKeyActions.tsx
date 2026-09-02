import type { ProviderId } from '@ark/contracts'

import { Button } from '@/components/ui/button'

type ProviderOperationResult = { ok: true; modelCount?: number } | { ok: false; error: string }

function refreshFailureMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not refresh models.'
}

export function AiProviderKeyActions({
  busy,
  configured,
  draft,
  id,
  label,
  onCredentialsChanged,
  onDraftChange,
  onMessage,
  run,
}: {
  busy: boolean
  configured: boolean
  draft: string
  id: ProviderId
  label: string
  onCredentialsChanged: () => void | Promise<void>
  onDraftChange: (value: string) => void
  onMessage: (message: string) => void
  run: (
    provider: ProviderId,
    operation: () => Promise<ProviderOperationResult>,
    successMessage: string,
  ) => Promise<boolean>
}) {
  const clearDraftAfterSave = async (ok: boolean) => {
    if (!ok) return
    onDraftChange('')
    await onCredentialsChanged()
  }

  return (
    <div className="flex justify-end gap-2">
      {configured ? (
        <Button
          disabled={busy}
          onClick={() => {
            void (async () => {
              if (
                await run(
                  id,
                  () => window.arkDesktop.credentials.remove(id),
                  `${label} key removed.`,
                )
              )
                await onCredentialsChanged()
            })().catch((error) => onMessage(refreshFailureMessage(error)))
          }}
          size="sm"
          variant="outline"
        >
          Remove
        </Button>
      ) : null}
      <Button
        disabled={busy || !draft.trim()}
        onClick={() => {
          void run(
            id,
            () => window.arkDesktop.credentials.test(id, draft),
            `${label} key is valid.`,
          )
        }}
        size="sm"
        variant="outline"
      >
        Test
      </Button>
      <Button
        disabled={busy || !draft.trim()}
        onClick={() => {
          void (async () => {
            await clearDraftAfterSave(
              await run(
                id,
                () => window.arkDesktop.credentials.saveSession(id, draft),
                `${label} key will be kept until Ark quits.`,
              ),
            )
          })().catch((error) => onMessage(refreshFailureMessage(error)))
        }}
        size="sm"
        variant="outline"
      >
        Use for session
      </Button>
      <Button
        disabled={busy || !draft.trim()}
        onClick={() => {
          void (async () => {
            await clearDraftAfterSave(
              await run(
                id,
                () => window.arkDesktop.credentials.save(id, draft),
                `${label} key saved.`,
              ),
            )
          })().catch((error) => onMessage(refreshFailureMessage(error)))
        }}
        size="sm"
      >
        Save
      </Button>
    </div>
  )
}
