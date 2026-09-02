import type { McpClientId, McpClientInstallationStatus } from '@ark/contracts'
import path from 'node:path'

export type ArkServerInvocation = {
  present: boolean
  command?: string
  args?: string[]
}

export const MCP_HEADLESS_FLAG = '--headless'
export const MCP_SERVER_FLAG = '--mcp'
export const MCP_SERVER_NAME = 'ark'

export const CLI_CLIENT_IDS = ['codex', 'claudeCode', 'grok', 'devinCli'] as const
export type McpCliClientId = (typeof CLI_CLIENT_IDS)[number]

export const FILE_CLIENT_IDS = ['cursor', 'openCode'] as const
export type McpFileClientId = (typeof FILE_CLIENT_IDS)[number]

export function isCliClientId(clientId: McpClientId): clientId is McpCliClientId {
  return (CLI_CLIENT_IDS as readonly string[]).includes(clientId)
}

export function isFileClientId(clientId: McpClientId): clientId is McpFileClientId {
  return (FILE_CLIENT_IDS as readonly string[]).includes(clientId)
}

export const CLI_BINARIES: Record<McpCliClientId, string> = {
  codex: 'codex',
  claudeCode: 'claude',
  grok: 'grok',
  devinCli: 'devin',
}

export const CLI_MISSING_ERRORS: Record<McpCliClientId, string> = {
  codex: 'Install Codex CLI to connect it to Ark.',
  claudeCode: 'Install Claude Code to connect it to Ark.',
  grok: 'Install Grok CLI to connect it to Ark.',
  devinCli: 'Install Devin CLI to connect it to Ark.',
}

export function splitExecutableArgs(executableArgs: string[]): { command: string; args: string[] } {
  const [command, ...args] = executableArgs
  if (!command) throw new Error('MCP executable path is missing.')
  return { command, args }
}

export function sameExecutablePath(
  left: string,
  right: string,
  platform: NodeJS.Platform,
): boolean {
  const normalizedLeft = path.normalize(left)
  const normalizedRight = path.normalize(right)
  return platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

export function argsIncludeMcpFlags(args: readonly string[]): boolean {
  return args.includes(MCP_HEADLESS_FLAG) && args.includes(MCP_SERVER_FLAG)
}

export function detectArkInstallationStatus(options: {
  expectedCommand: string
  actual: ArkServerInvocation
  platform: NodeJS.Platform
}): Exclude<McpClientInstallationStatus, 'unavailable'> {
  if (!options.actual.present) return 'notInstalled'
  const command = options.actual.command?.trim()
  const args = options.actual.args ?? []
  if (
    command &&
    sameExecutablePath(command, options.expectedCommand, options.platform) &&
    argsIncludeMcpFlags(args)
  ) {
    return 'installed'
  }
  return 'needsUpdate'
}

export function buildCliAddArgs(clientId: McpCliClientId, executableArgs: string[]): string[] {
  switch (clientId) {
    case 'codex':
    case 'grok':
      return ['mcp', 'add', MCP_SERVER_NAME, '--', ...executableArgs]
    case 'claudeCode':
      return [
        'mcp',
        'add',
        '--transport',
        'stdio',
        '--scope',
        'user',
        MCP_SERVER_NAME,
        '--',
        ...executableArgs,
      ]
    case 'devinCli':
      return ['mcp', 'add', '-s', 'user', MCP_SERVER_NAME, '--', ...executableArgs]
  }
}

export function buildCliRemoveArgs(clientId: McpCliClientId): string[] {
  switch (clientId) {
    case 'codex':
    case 'grok':
      return ['mcp', 'remove', MCP_SERVER_NAME]
    case 'claudeCode':
      return ['mcp', 'remove', MCP_SERVER_NAME, '--scope', 'user']
    case 'devinCli':
      return ['mcp', 'remove', MCP_SERVER_NAME, '-s', 'user']
  }
}

export function buildCliDetectCommands(clientId: McpCliClientId): string[][] {
  switch (clientId) {
    case 'codex':
      return [
        ['mcp', 'get', MCP_SERVER_NAME, '--json'],
        ['mcp', 'get', MCP_SERVER_NAME],
        ['mcp', 'list', '--json'],
      ]
    case 'claudeCode':
      return [
        ['mcp', 'get', MCP_SERVER_NAME, '--json'],
        ['mcp', 'get', MCP_SERVER_NAME],
      ]
    case 'grok':
      return [
        ['mcp', 'list', '--json'],
        ['mcp', 'list'],
      ]
    case 'devinCli':
      return [
        ['mcp', 'get', MCP_SERVER_NAME, '--json'],
        ['mcp', 'get', MCP_SERVER_NAME],
        ['mcp', 'get', MCP_SERVER_NAME, '-s', 'user'],
      ]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringList(value: unknown): string[] | undefined {
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim().split(/\s+/)
  }
  return undefined
}

function invocationFromFields(command: unknown, args: unknown): ArkServerInvocation | null {
  if (Array.isArray(command) && command.every((entry) => typeof entry === 'string')) {
    const [executable, ...rest] = command
    return { present: true, command: executable, args: rest }
  }
  if (typeof command === 'string' && command.trim()) {
    return { present: true, command: command.trim(), args: stringList(args) ?? [] }
  }
  return null
}

function invocationFromServerConfig(value: unknown): ArkServerInvocation | null {
  if (!isRecord(value)) return value === undefined ? null : { present: true }
  if (isRecord(value.transport)) {
    const fromTransport = invocationFromFields(value.transport.command, value.transport.args)
    if (fromTransport) return fromTransport
  }
  return (
    invocationFromFields(value.command, value.args) ??
    invocationFromFields(value.cmd, value.args) ?? { present: true }
  )
}

function namedServer(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.name === 'string') return value.name
  if (typeof value.id === 'string') return value.id
  return undefined
}

export function extractArkInvocation(
  payload: unknown,
  name = MCP_SERVER_NAME,
): ArkServerInvocation {
  if (payload == null) return { present: false }

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      if (namedServer(entry) === name) {
        return invocationFromServerConfig(entry) ?? { present: true }
      }
      if (isRecord(entry) && isRecord(entry[name])) {
        return invocationFromServerConfig(entry[name]) ?? { present: true }
      }
    }
    return { present: false }
  }

  if (!isRecord(payload)) return { present: false }

  if (namedServer(payload) === name) {
    return invocationFromServerConfig(payload) ?? { present: true }
  }

  const nestedKeys = ['mcpServers', 'servers', 'mcp', 'mcp_servers'] as const
  for (const key of nestedKeys) {
    const nested = payload[key]
    if (nested === undefined) continue
    const fromNested = extractArkInvocation(nested, name)
    if (fromNested.present) return fromNested
  }

  if (payload[name] !== undefined) {
    return invocationFromServerConfig(payload[name]) ?? { present: true }
  }

  return { present: false }
}

const NOT_INSTALLED_PATTERN =
  /not found|does not exist|no mcp server|unknown server|isn't configured|is not configured|no server named|could not find/i

function tryParseJsonValue(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.search(/[[{]/)
    if (start < 0) return undefined
    try {
      return JSON.parse(trimmed.slice(start))
    } catch {
      return undefined
    }
  }
}

function invocationFromText(text: string): ArkServerInvocation {
  if (NOT_INSTALLED_PATTERN.test(text) && !/\bcommand\b/i.test(text)) {
    return { present: false }
  }

  const commandMatch = text.match(/^\s*command\s*[:=]\s*(.+)$/im)
  const argsMatch = text.match(/^\s*args\s*[:=]\s*(.+)$/im)
  if (!commandMatch && !argsMatch) {
    return /(?:^|\n)\s*ark\b/i.test(text) ? { present: true } : { present: false }
  }

  const command = commandMatch?.[1]?.trim().replace(/^["']|["']$/g, '')
  const args = argsMatch?.[1] ? (stringList(argsMatch[1].replace(/^\[|\]$/g, '')) ?? []) : []
  return { present: true, command, args }
}

export function parseCliServerOutput(
  stdout: string,
  stderr = '',
  name = MCP_SERVER_NAME,
): ArkServerInvocation {
  const text = [stdout, stderr].filter(Boolean).join('\n').trim()
  if (!text) return { present: false }

  const parsed = tryParseJsonValue(stdout.trim() || text)
  if (parsed !== undefined) return extractArkInvocation(parsed, name)

  return invocationFromText(text)
}

export function clipErrorMessage(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 1_000)
}
