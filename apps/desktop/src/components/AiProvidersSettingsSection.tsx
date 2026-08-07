import { useEffect, useState } from 'react'
import type { ProviderId } from '@ark/contracts'

import { Button } from '@/components/ui/button'
import { ProviderLogo } from '@/components/ProviderLogo'
import { Input } from '@/components/ui/input'

const PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google Gemini' },
]

type ProviderStatus = Record<
  ProviderId,
  { configured: boolean; storage: 'persistent' | 'session' | null }
>

const EMPTY_STATUS: ProviderStatus = {
  openai: { configured: false, storage: null },
  anthropic: { configured: false, storage: null },
  google: { configured: false, storage: null },
}

export function AiProvidersSettingsSection({
  onCredentialsChanged,
  onMessage,
  open,
}: {
  onCredentialsChanged: () => void | Promise<void>
  onMessage: (message: string) => void
  open: boolean
}) {
  const [status, setStatus] = useState<ProviderStatus>(EMPTY_STATUS)
  const [drafts, setDrafts] = useState<Partial<Record<ProviderId, string>>>({})
  const [busyProvider, setBusyProvider] = useState<ProviderId | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void window.arkDesktop.credentials.list().then((nextStatus) => {
      if (!cancelled) setStatus(nextStatus)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  const run = async (
    provider: ProviderId,
    operation: () => Promise<{ ok: true; modelCount?: number } | { ok: false; error: string }>,
    successMessage: string,
  ) => {
    setBusyProvider(provider)
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
      setStatus(await window.arkDesktop.credentials.list())
      return true
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'The operation failed.')
      return false
    } finally {
      setBusyProvider(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {PROVIDERS.map(({ id, label }) => {
        const draft = drafts[id] ?? ''
        const configured = status[id].configured
        const storage = status[id].storage
        const busy = busyProvider === id

        return (
          <section className="flex flex-col gap-2" key={id}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 font-medium" htmlFor={`ark-key-${id}`}>
                <ProviderLogo className="size-5" provider={id} />
                <span>{label}</span>
              </label>
              <span className="text-xs text-muted-foreground">
                {configured
                  ? storage === 'session'
                    ? 'Session only'
                    : 'Saved securely'
                  : 'Not configured'}
              </span>
            </div>
            <Input
              autoComplete="off"
              id={`ark-key-${id}`}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [id]: event.target.value }))
              }
              placeholder={configured ? 'Enter a replacement key' : 'Enter API key'}
              type="password"
              value={draft}
            />
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
                    })().catch((error) => {
                      onMessage(
                        error instanceof Error ? error.message : 'Could not refresh models.',
                      )
                    })
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
                    if (
                      await run(
                        id,
                        () => window.arkDesktop.credentials.saveSession(id, draft),
                        `${label} key will be kept until Ark quits.`,
                      )
                    ) {
                      setDrafts((current) => ({ ...current, [id]: '' }))
                      await onCredentialsChanged()
                    }
                  })().catch((error) => {
                    onMessage(error instanceof Error ? error.message : 'Could not refresh models.')
                  })
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
                    if (
                      await run(
                        id,
                        () => window.arkDesktop.credentials.save(id, draft),
                        `${label} key saved.`,
                      )
                    ) {
                      setDrafts((current) => ({ ...current, [id]: '' }))
                      await onCredentialsChanged()
                    }
                  })().catch((error) => {
                    onMessage(error instanceof Error ? error.message : 'Could not refresh models.')
                  })
                }}
                size="sm"
              >
                Save
              </Button>
            </div>
          </section>
        )
      })}
    </div>
  )
}
