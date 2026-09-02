import { useEffect, useState } from 'react'
import {
  MCP_CLIENT_IDS,
  type McpClientId,
  type McpClientInstallation,
  type McpStatus,
} from '@ark/contracts'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

import { installationFor, MCP_CLIENT_LABELS } from './mcp-client-install.ts'
import { McpClientInstallList } from './McpClientInstallList.tsx'

const EMPTY_STATUS: McpStatus = {
  state: 'stopped',
  autoStart: false,
  activeDeckId: null,
  activeDeckTitle: null,
  connectedClient: null,
  lastActivity: null,
  error: null,
}

export function McpSettingsSection({
  onMessage,
  open,
}: {
  onMessage: (message: string) => void
  open: boolean
}) {
  const [status, setStatus] = useState(EMPTY_STATUS)
  const [installations, setInstallations] = useState<McpClientInstallation[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyClientId, setBusyClientId] = useState<McpClientId | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void Promise.all([
      window.arkDesktop.mcp.getStatus(),
      window.arkDesktop.mcp.getClientInstallations(),
    ]).then(([nextStatus, nextInstallations]) => {
      if (!cancelled) {
        setStatus(nextStatus)
        setInstallations(nextInstallations)
      }
    })
    const unsubscribe = window.arkDesktop.mcp.onStatusChanged((nextStatus) => {
      if (!cancelled) setStatus(nextStatus)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [open])

  const replaceInstallation = (next: McpClientInstallation) => {
    setInstallations((current) =>
      MCP_CLIENT_IDS.map((clientId) =>
        clientId === next.clientId ? next : installationFor(current ?? [], clientId),
      ),
    )
  }

  const runClientAction = (
    clientId: McpClientId,
    verb: 'add' | 'remove' | 'update',
    operation: () => Promise<McpClientInstallation>,
  ) => {
    const label = MCP_CLIENT_LABELS[clientId]
    const doneLabel = verb === 'add' ? 'installed' : verb === 'remove' ? 'removed' : 'updated'
    setBusyClientId(clientId)
    void operation()
      .then((next) => {
        replaceInstallation(next)
        onMessage(
          next.status === 'unavailable'
            ? (next.error ?? `Could not ${verb} ${label}.`)
            : `${label} ${doneLabel}.`,
        )
      })
      .catch((error) => {
        onMessage(error instanceof Error ? error.message : `Could not ${verb} ${label}.`)
      })
      .finally(() => setBusyClientId(null))
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">External agents (MCP)</h2>
          <p className="text-xs text-muted-foreground">
            Let Codex, Claude Code, Grok, Cursor, OpenCode, or Devin CLI edit the presentation
            currently open in Ark.
          </p>
        </div>
        <Badge variant={status.state === 'running' ? 'default' : 'secondary'}>
          {status.state === 'running' ? 'Running' : 'Stopped'}
        </Badge>
      </div>
      <div>
        <Button
          disabled={busy || status.state === 'stopping'}
          onClick={() => {
            setBusy(true)
            const operation =
              status.state === 'running'
                ? window.arkDesktop.mcp.stop()
                : window.arkDesktop.mcp.start()
            void operation
              .then(setStatus)
              .catch((error) =>
                onMessage(error instanceof Error ? error.message : 'MCP operation failed.'),
              )
              .finally(() => setBusy(false))
          }}
          size="sm"
          variant={status.state === 'running' ? 'outline' : 'default'}
        >
          {status.state === 'running' ? 'Stop MCP server' : 'Start MCP server'}
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={status.autoStart}
          onCheckedChange={(checked) => {
            void window.arkDesktop.mcp.setAutoStart(checked === true).then(setStatus)
          }}
        />
        Start automatically when Ark opens
      </label>
      {status.state === 'running' && installations !== null ? (
        <McpClientInstallList
          busyClientId={busyClientId}
          installations={installations}
          runClientAction={runClientAction}
        />
      ) : null}
      {status.error ? <p className="text-xs text-destructive">{status.error}</p> : null}
    </section>
  )
}
