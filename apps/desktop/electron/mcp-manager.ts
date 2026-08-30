import { randomBytes } from 'node:crypto'

import type {
  ExternalDeckUpdate,
  McpActivityEvent,
  McpSetupCommands,
  McpStatus,
} from '@ark/contracts'
import type { McpServiceState } from '@ark/api/mcp-service.ts'
import type { McpInteractionStore } from '@ark/api/mcp-interactions.ts'
import {
  mcpDiscoveryPath,
  removeMcpDiscovery,
  writeMcpDiscovery,
} from '@ark/mcp-server/discovery.ts'

const quoteExecutable = (value: string) => `"${value.replaceAll('"', '\\"')}"`
const commandArgument = (value: string, index: number) =>
  index === 0 || /\s/.test(value) ? quoteExecutable(value) : value
const sanitizeClientName = (value: string | null) => {
  const sanitized = value
    ?.replace(/[^\p{L}\p{N} ._()-]/gu, '')
    .trim()
    .slice(0, 100)
  return sanitized || null
}

export function resolveMcpExecutableArgs(options: {
  isPackaged: boolean
  execPath: string
  appPath: string
  platform: NodeJS.Platform
  appImagePath?: string
}) {
  if (!options.isPackaged) return [options.execPath, '--headless', options.appPath, '--mcp']
  // process.execPath points inside AppImage's temporary mount, while APPIMAGE
  // is the stable file the user actually installed.
  const executable =
    options.platform === 'linux' && options.appImagePath ? options.appImagePath : options.execPath
  return [executable, '--headless', '--mcp']
}

export class McpManager {
  private readonly options: {
    apiOrigin: string
    userDataDirectory: string
    serviceState: McpServiceState
    interactionStore: McpInteractionStore
    getAutoStart: () => boolean
    setAutoStart: (enabled: boolean) => Promise<void>
    executableArgs: string[]
    onStatusChanged: (status: McpStatus) => void
    onDeckUpdated: (update: ExternalDeckUpdate) => void
  }
  private state: McpStatus['state'] = 'stopped'
  private activeDeckId: string | null = null
  private activeDeckTitle: string | null = null
  private connectedClient: string | null = null
  private lastActivity: McpStatus['lastActivity'] = null
  private error: string | null = null
  private readonly discoveryPath: string

  constructor(options: {
    apiOrigin: string
    userDataDirectory: string
    serviceState: McpServiceState
    interactionStore: McpInteractionStore
    getAutoStart: () => boolean
    setAutoStart: (enabled: boolean) => Promise<void>
    executableArgs: string[]
    onStatusChanged: (status: McpStatus) => void
    onDeckUpdated: (update: ExternalDeckUpdate) => void
  }) {
    this.options = options
    this.discoveryPath = mcpDiscoveryPath(options.userDataDirectory)
  }

  getStatus(): McpStatus {
    return {
      state: this.state,
      autoStart: this.options.getAutoStart(),
      activeDeckId: this.activeDeckId,
      activeDeckTitle: this.activeDeckTitle,
      connectedClient: this.connectedClient,
      lastActivity: this.lastActivity,
      error: this.error,
    }
  }

  private notify() {
    const status = this.getStatus()
    this.options.onStatusChanged(status)
    return status
  }

  async cleanupStartup() {
    this.options.serviceState.stop()
    this.options.interactionStore.cancelAll()
    await removeMcpDiscovery(this.discoveryPath)
  }

  async start() {
    if (this.state === 'running') return this.getStatus()
    const sessionCapability = randomBytes(32).toString('base64url')
    try {
      await writeMcpDiscovery(this.discoveryPath, {
        schemaVersion: 1,
        apiOrigin: this.options.apiOrigin,
        pid: process.pid,
        sessionCapability,
        startedAt: new Date().toISOString(),
      })
      this.options.serviceState.start(sessionCapability)
      this.state = 'running'
      this.error = null
    } catch (error) {
      this.options.serviceState.stop()
      await removeMcpDiscovery(this.discoveryPath).catch(() => undefined)
      this.state = 'stopped'
      this.error = error instanceof Error ? error.message : 'Could not start MCP.'
    }
    return this.notify()
  }

  async stop() {
    this.options.serviceState.stop()
    this.options.interactionStore.cancelAll()
    this.state = 'stopping'
    this.notify()
    await removeMcpDiscovery(this.discoveryPath).catch(() => undefined)
    this.state = 'stopped'
    this.connectedClient = null
    this.error = null
    return this.notify()
  }

  async setAutoStart(enabled: boolean) {
    await this.options.setAutoStart(enabled)
    return this.notify()
  }

  setActiveDeck(deckId: string | null, title: string | null, documentRevision: number | null) {
    this.activeDeckId = deckId
    this.activeDeckTitle = title
    this.options.serviceState.setActiveDeck(deckId)
    this.options.interactionStore.cancelForTarget(deckId, documentRevision)
    this.notify()
  }

  recordExternalUpdate(update: ExternalDeckUpdate) {
    this.options.interactionStore.cancelForTarget(update.deckId, update.documentRevision)
    this.recordActivity(
      {
        clientName: update.clientName,
        toolName: update.toolName,
        summary: update.summary,
        occurredAt: new Date().toISOString(),
        failed: false,
      },
      false,
    )
    this.options.onDeckUpdated(update)
  }

  recordActivity(activity: McpActivityEvent, notify = true) {
    const clientName = sanitizeClientName(activity.clientName)
    this.connectedClient = clientName
    this.lastActivity = {
      clientName,
      toolName: activity.toolName,
      summary: activity.summary.slice(0, 500),
      occurredAt: activity.occurredAt,
    }
    this.error = activity.failed ? activity.summary.slice(0, 500) : null
    if (notify) this.notify()
  }

  getSetupCommands(): McpSetupCommands {
    const command = this.options.executableArgs.map(commandArgument).join(' ')
    return {
      codex: `codex mcp add ark -- ${command}`,
      claudeCode: `claude mcp add --transport stdio --scope user ark -- ${command}`,
    }
  }
}
