import { useEffect, useRef, useState } from 'react'
import type { McpSetupCommands, McpStatus } from '@ark/contracts'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'

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
  const [commands, setCommands] = useState<McpSetupCommands>({ codex: '', claudeCode: '' })
  const [busy, setBusy] = useState(false)
  const [copiedClient, setCopiedClient] = useState<string | null>(null)
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void Promise.all([
      window.arkDesktop.mcp.getStatus(),
      window.arkDesktop.mcp.getSetupCommands(),
    ]).then(([nextStatus, nextCommands]) => {
      if (!cancelled) {
        setStatus(nextStatus)
        setCommands(nextCommands)
      }
    })
    const unsubscribe = window.arkDesktop.mcp.onStatusChanged((nextStatus) => {
      if (!cancelled) setStatus(nextStatus)
    })
    return () => {
      cancelled = true
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current)
      unsubscribe()
    }
  }, [open])

  const copyCommand = async (label: string, command: string) => {
    try {
      await window.arkDesktop.mcp.copySetupCommand(command)
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current)
      setCopiedClient(label)
      copyResetTimer.current = setTimeout(() => {
        setCopiedClient(null)
        copyResetTimer.current = null
      }, 5_000)
      onMessage(`${label} setup command copied.`)
    } catch {
      onMessage(`Could not copy the ${label} setup command.`)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">External agents (MCP)</h2>
          <p className="text-xs text-muted-foreground">
            Let Codex or Claude Code edit the presentation currently open in Ark.
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
      {status.state === 'running'
        ? (
            Object.entries({ Codex: commands.codex, 'Claude Code': commands.claudeCode }) as Array<
              [string, string]
            >
          ).map(([label, command]) => (
            <div className="flex flex-col gap-1" key={label}>
              <span className="text-xs font-medium">{label}</span>
              <div className="flex gap-2">
                <Input aria-label={`${label} setup command`} readOnly value={command} />
                <Button
                  aria-label={
                    copiedClient === label
                      ? `${label} setup command copied`
                      : `Copy ${label} setup command`
                  }
                  aria-live="polite"
                  onClick={() => {
                    void copyCommand(label, command)
                  }}
                  size="sm"
                  variant="outline"
                >
                  {copiedClient === label ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          ))
        : null}
      {status.error ? <p className="text-xs text-destructive">{status.error}</p> : null}
    </section>
  )
}
