import {
  type McpClientId,
  type McpClientInstallation,
  type McpClientInstallationStatus,
} from '@ark/contracts'

export const MCP_CLIENT_LABELS: Record<McpClientId, string> = {
  codex: 'Codex',
  claudeCode: 'Claude Code',
  grok: 'Grok',
  cursor: 'Cursor',
  openCode: 'OpenCode',
  devinCli: 'Devin CLI',
}

export const INSTALLATION_STATUS_LABELS: Record<McpClientInstallationStatus, string> = {
  notInstalled: 'Not installed',
  installed: 'Installed',
  needsUpdate: 'Needs update',
  unavailable: 'Unavailable',
}

export function installationFor(
  installations: McpClientInstallation[],
  clientId: McpClientId,
): McpClientInstallation {
  return (
    installations.find((item) => item.clientId === clientId) ?? {
      clientId,
      status: 'notInstalled',
    }
  )
}
