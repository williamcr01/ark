import { useEffect, useState } from 'react'
import type { ProviderId } from '@ark/contracts'
import { LaptopIcon, MoonIcon, SunIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { AppearancePreference } from '@/hooks/useAppearance'

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

export function DesktopSettingsDialog({
  appearancePreference,
  onAppearanceChange,
  onCredentialsChanged,
  onOpenChange,
  open,
}: {
  appearancePreference: AppearancePreference
  onAppearanceChange: (preference: AppearancePreference) => void
  onCredentialsChanged: () => void | Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const [status, setStatus] = useState<ProviderStatus>(EMPTY_STATUS)
  const [drafts, setDrafts] = useState<Partial<Record<ProviderId, string>>>({})
  const [message, setMessage] = useState('')
  const [busyProvider, setBusyProvider] = useState<ProviderId | null>(null)

  const refresh = async () => {
    setStatus(await window.arkDesktop.credentials.list())
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setMessage('')
    void window.arkDesktop.credentials
      .list()
      .then((nextStatus) => {
        if (!cancelled) setStatus(nextStatus)
      })
      .catch((error) => {
        if (!cancelled)
          setMessage(error instanceof Error ? error.message : 'Could not load credentials.')
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
    setMessage('')
    try {
      const result = await operation()
      if (!result.ok) {
        setMessage(result.error)
        return false
      }
      setMessage(
        result.modelCount === undefined
          ? successMessage
          : `${successMessage} ${result.modelCount} models are available.`,
      )
      await refresh()
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The operation failed.')
      return false
    } finally {
      setBusyProvider(null)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Manage Ark&apos;s appearance and AI providers. Keys are encrypted with your operating
            system&apos;s secure storage and stay on this device.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <section className="flex flex-col gap-2 rounded-lg border p-3">
            <div>
              <h2 className="font-medium">Appearance</h2>
              <p className="text-xs text-muted-foreground">Choose how Ark looks on this device.</p>
            </div>
            <ToggleGroup
              aria-label="Appearance"
              className="w-full"
              onValueChange={(value) => {
                if (value) onAppearanceChange(value as AppearancePreference)
              }}
              type="single"
              value={appearancePreference}
            >
              <ToggleGroupItem aria-label="System theme" className="flex-1" value="system">
                <LaptopIcon />
                System
              </ToggleGroupItem>
              <ToggleGroupItem aria-label="Light theme" className="flex-1" value="light">
                <SunIcon />
                Light
              </ToggleGroupItem>
              <ToggleGroupItem aria-label="Dark theme" className="flex-1" value="dark">
                <MoonIcon />
                Dark
              </ToggleGroupItem>
            </ToggleGroup>
          </section>
          {PROVIDERS.map(({ id, label }) => {
            const draft = drafts[id] ?? ''
            const configured = status[id].configured
            const storage = status[id].storage
            const busy = busyProvider === id

            return (
              <section className="rounded-lg border p-3" key={id}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="font-medium" htmlFor={`ark-key-${id}`}>
                    {label}
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
                <div className="mt-2 flex justify-end gap-2">
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
                          setMessage(
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
                        setMessage(
                          error instanceof Error ? error.message : 'Could not refresh models.',
                        )
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
                        setMessage(
                          error instanceof Error ? error.message : 'Could not refresh models.',
                        )
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
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              void window.arkDesktop.updates
                .check()
                .then((result) => {
                  setMessage(result.ok ? 'Update check started.' : result.error)
                })
                .catch((error) => {
                  setMessage(error instanceof Error ? error.message : 'Update check failed.')
                })
            }}
            variant="outline"
          >
            Check for updates
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
