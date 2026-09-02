import { MCP_CLIENT_IDS, type McpClientId, type McpClientInstallation } from '@ark/contracts'

import { Button } from '@/components/ui/button'

import {
  INSTALLATION_STATUS_LABELS,
  MCP_CLIENT_LABELS,
  installationFor,
} from './mcp-client-install.ts'

export function McpClientInstallRow({
  clientId,
  installation,
  rowBusy,
  runClientAction,
}: {
  clientId: McpClientId
  installation: McpClientInstallation
  rowBusy: boolean
  runClientAction: (
    clientId: McpClientId,
    verb: 'add' | 'remove' | 'update',
    operation: () => Promise<McpClientInstallation>,
  ) => void
}) {
  const label = MCP_CLIENT_LABELS[clientId]
  const unavailable = installation.status === 'unavailable'
  const actionsDisabled = rowBusy || unavailable

  return (
    <div className="flex flex-col gap-1" role="group" aria-label={label}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {INSTALLATION_STATUS_LABELS[installation.status]}
          </span>
          {installation.status === 'notInstalled' || unavailable ? (
            <Button
              disabled={actionsDisabled}
              onClick={() =>
                runClientAction(clientId, 'add', () => window.arkDesktop.mcp.addClient(clientId))
              }
              size="sm"
            >
              Add
            </Button>
          ) : null}
          {installation.status === 'needsUpdate' ? (
            <Button
              disabled={actionsDisabled}
              onClick={() =>
                runClientAction(clientId, 'update', () =>
                  window.arkDesktop.mcp.updateClient(clientId),
                )
              }
              size="sm"
            >
              Update
            </Button>
          ) : null}
          {installation.status === 'installed' || installation.status === 'needsUpdate' ? (
            <Button
              disabled={actionsDisabled}
              onClick={() =>
                runClientAction(clientId, 'remove', () =>
                  window.arkDesktop.mcp.removeClient(clientId),
                )
              }
              size="sm"
              variant="outline"
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      {unavailable && installation.error ? (
        <p className="text-xs text-destructive">{installation.error}</p>
      ) : null}
    </div>
  )
}

export function McpClientInstallList({
  busyClientId,
  installations,
  runClientAction,
}: {
  busyClientId: McpClientId | null
  installations: McpClientInstallation[]
  runClientAction: (
    clientId: McpClientId,
    verb: 'add' | 'remove' | 'update',
    operation: () => Promise<McpClientInstallation>,
  ) => void
}) {
  return (
    <>
      {MCP_CLIENT_IDS.map((clientId) => (
        <McpClientInstallRow
          clientId={clientId}
          installation={installationFor(installations, clientId)}
          key={clientId}
          rowBusy={busyClientId === clientId}
          runClientAction={runClientAction}
        />
      ))}
    </>
  )
}
