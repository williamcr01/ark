import { useEffect, useState } from 'react'
import { ALL_PROVIDERS, type ProviderId } from '@ark/contracts'

import { ProviderLogo } from '@/components/ProviderLogo'
import { Input } from '@/components/ui/input'

import { AiProviderKeyActions } from './AiProviderKeyActions.tsx'
import { runProviderCredential } from './AiProviderKeyRow.tsx'

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  openrouter: 'OpenRouter',
}

const PROVIDERS = ALL_PROVIDERS.map((id) => ({ id, label: PROVIDER_LABELS[id] }))

const EMPTY_CATALOG_WARNINGS: string[] = []

type ProviderStatus = Record<
  ProviderId,
  { configured: boolean; storage: 'persistent' | 'session' | null }
>

const EMPTY_STATUS: ProviderStatus = Object.fromEntries(
  ALL_PROVIDERS.map((id) => [id, { configured: false, storage: null }]),
) as ProviderStatus

export function AiProvidersSettingsSection({
  catalogWarnings = EMPTY_CATALOG_WARNINGS,
  onCredentialsChanged,
  onMessage,
  open,
}: {
  catalogWarnings?: string[]
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

  const run = (
    provider: ProviderId,
    operation: () => Promise<{ ok: true; modelCount?: number } | { ok: false; error: string }>,
    successMessage: string,
  ) =>
    runProviderCredential(
      provider,
      operation,
      successMessage,
      setBusyProvider,
      onMessage,
      async () => {
        setStatus(await window.arkDesktop.credentials.list())
      },
    )

  return (
    <div className="flex flex-col gap-6">
      {catalogWarnings.length > 0 ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Model catalog notice</p>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {catalogWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {PROVIDERS.map(({ id, label }) => (
        <AiProviderKeyRow
          busy={busyProvider === id}
          configured={status[id].configured}
          draft={drafts[id] ?? ''}
          id={id}
          key={id}
          label={label}
          onCredentialsChanged={onCredentialsChanged}
          onDraftChange={(value) => setDrafts((current) => ({ ...current, [id]: value }))}
          onMessage={onMessage}
          run={run}
          storage={status[id].storage}
        />
      ))}
    </div>
  )
}

function AiProviderKeyRow({
  busy,
  configured,
  draft,
  id,
  label,
  onCredentialsChanged,
  onDraftChange,
  onMessage,
  run,
  storage,
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
    operation: () => Promise<{ ok: true; modelCount?: number } | { ok: false; error: string }>,
    successMessage: string,
  ) => Promise<boolean>
  storage: 'persistent' | 'session' | null
}) {
  return (
    <section className="flex flex-col gap-2">
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
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder={configured ? 'Enter a replacement key' : 'Enter API key'}
        type="password"
        value={draft}
      />
      <AiProviderKeyActions
        busy={busy}
        configured={configured}
        draft={draft}
        id={id}
        label={label}
        onCredentialsChanged={onCredentialsChanged}
        onDraftChange={onDraftChange}
        onMessage={onMessage}
        run={run}
      />
    </section>
  )
}
