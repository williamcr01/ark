import type { McpClientId, McpClientInstallation, McpClientInstallations } from '@ark/contracts'
import { MCP_CLIENT_IDS } from '@ark/contracts'

import {
  type McpClientHost,
  cliBinaryName,
  resolveCliBinary,
  runCli,
  type CliRunResult,
} from './mcp-client-cli.ts'
import {
  cursorArkInvocation,
  mergeCursorArk,
  mergeOpenCodeArk,
  readCursorConfig,
  readOpenCodeConfig,
  removeCursorArk,
  removeOpenCodeArk,
  openCodeArkInvocation,
} from './mcp-client-config.ts'
import {
  CLI_MISSING_ERRORS,
  buildCliAddArgs,
  buildCliDetectCommands,
  buildCliRemoveArgs,
  clipErrorMessage,
  detectArkInstallationStatus,
  parseCliServerOutput,
  splitExecutableArgs,
  type McpCliClientId,
} from './mcp-client-status.ts'

function installation(
  clientId: McpClientId,
  status: McpClientInstallation['status'],
  error?: string,
): McpClientInstallation {
  return error ? { clientId, status, error: clipErrorMessage(error) } : { clientId, status }
}

function looksLikeNotInstalled(result: CliRunResult): boolean {
  const text = `${result.stdout}\n${result.stderr}`
  return /not found|does not exist|no mcp server|unknown server|isn't configured|is not configured|no server named|could not find/i.test(
    text,
  )
}

async function detectCliClient(
  host: McpClientHost,
  clientId: McpCliClientId,
): Promise<McpClientInstallation> {
  const binaryName = cliBinaryName(clientId)
  const binary = await resolveCliBinary(binaryName, host)
  if (!binary) return installation(clientId, 'unavailable', CLI_MISSING_ERRORS[clientId])

  const { command } = splitExecutableArgs(host.executableArgs)
  let lastError = ''
  for (const args of buildCliDetectCommands(clientId)) {
    const ran = await runCli(host, binaryName, args)
    const result = ran.result
    if (!result) continue
    if (result.error) {
      lastError = result.error
      continue
    }
    const invocation = parseCliServerOutput(result.stdout, result.stderr)
    if (invocation.present) {
      return installation(
        clientId,
        detectArkInstallationStatus({
          expectedCommand: command,
          actual: invocation,
          platform: host.platform,
        }),
      )
    }
    if (result.code === 0 || looksLikeNotInstalled(result)) {
      return installation(clientId, 'notInstalled')
    }
    lastError = clipErrorMessage(
      result.stderr || result.stdout || `Command failed (${result.code}).`,
    )
  }

  return installation(clientId, lastError ? 'unavailable' : 'notInstalled', lastError || undefined)
}

async function detectCursor(host: McpClientHost): Promise<McpClientInstallation> {
  const { command } = splitExecutableArgs(host.executableArgs)
  const existing = await readCursorConfig(host.homedir)
  if (existing.kind === 'missing') return installation('cursor', 'notInstalled')
  if (existing.kind === 'corrupt') return installation('cursor', 'unavailable', existing.error)
  const invocation = cursorArkInvocation(existing.value)
  if (invocation === 'corrupt') {
    return installation(
      'cursor',
      'unavailable',
      `Cursor MCP config is unreadable. Fix ${existing.filePath} and try again.`,
    )
  }
  return installation(
    'cursor',
    detectArkInstallationStatus({
      expectedCommand: command,
      actual: invocation,
      platform: host.platform,
    }),
  )
}

async function detectOpenCode(host: McpClientHost): Promise<McpClientInstallation> {
  const { command } = splitExecutableArgs(host.executableArgs)
  const existing = await readOpenCodeConfig(host.homedir, host.env)
  if (existing.kind === 'missing') return installation('openCode', 'notInstalled')
  if (existing.kind === 'corrupt') return installation('openCode', 'unavailable', existing.error)
  const invocation = openCodeArkInvocation(existing.value)
  if (invocation === 'corrupt') {
    return installation(
      'openCode',
      'unavailable',
      `OpenCode config is unreadable. Fix ${existing.filePath} and try again.`,
    )
  }
  return installation(
    'openCode',
    detectArkInstallationStatus({
      expectedCommand: command,
      actual: invocation,
      platform: host.platform,
    }),
  )
}

async function detectClient(
  host: McpClientHost,
  clientId: McpClientId,
): Promise<McpClientInstallation> {
  if (clientId === 'cursor') return detectCursor(host)
  if (clientId === 'openCode') return detectOpenCode(host)
  return detectCliClient(host, clientId)
}

export async function getMcpClientInstallations(
  host: McpClientHost,
): Promise<McpClientInstallations> {
  return Promise.all(MCP_CLIENT_IDS.map((clientId) => detectClient(host, clientId)))
}

async function addCliClient(
  host: McpClientHost,
  clientId: McpCliClientId,
): Promise<McpClientInstallation> {
  const binaryName = cliBinaryName(clientId)
  const binary = await resolveCliBinary(binaryName, host)
  if (!binary) return installation(clientId, 'unavailable', CLI_MISSING_ERRORS[clientId])

  const addArgs = buildCliAddArgs(clientId, host.executableArgs)
  let ran = await runCli(host, binaryName, addArgs)
  if (ran.result && ran.result.code !== 0 && !ran.result.error) {
    await runCli(host, binaryName, buildCliRemoveArgs(clientId))
    ran = await runCli(host, binaryName, addArgs)
  }

  if (!ran.result || ran.result.error || ran.result.code !== 0) {
    const error =
      ran.result?.error ||
      ran.result?.stderr ||
      ran.result?.stdout ||
      'Could not add the MCP server.'
    const after = await detectCliClient(host, clientId)
    if (after.status === 'installed') return after
    return installation(clientId, 'unavailable', error)
  }

  return detectCliClient(host, clientId)
}

async function removeCliClient(
  host: McpClientHost,
  clientId: McpCliClientId,
): Promise<McpClientInstallation> {
  const binaryName = cliBinaryName(clientId)
  const binary = await resolveCliBinary(binaryName, host)
  if (!binary) return installation(clientId, 'unavailable', CLI_MISSING_ERRORS[clientId])

  const ran = await runCli(host, binaryName, buildCliRemoveArgs(clientId))
  if (ran.result?.error) return installation(clientId, 'unavailable', ran.result.error)
  if (ran.result && ran.result.code !== 0 && !looksLikeNotInstalled(ran.result)) {
    const after = await detectCliClient(host, clientId)
    if (after.status === 'notInstalled') return after
    return installation(
      clientId,
      'unavailable',
      ran.result.stderr || ran.result.stdout || 'Could not remove the MCP server.',
    )
  }
  return detectCliClient(host, clientId)
}

export async function addMcpClient(
  host: McpClientHost,
  clientId: McpClientId,
): Promise<McpClientInstallation> {
  if (clientId === 'cursor') {
    const result = await mergeCursorArk(host.homedir, host.executableArgs)
    if (result.status === 'corrupt') return installation(clientId, 'unavailable', result.error)
    return detectCursor(host)
  }
  if (clientId === 'openCode') {
    const result = await mergeOpenCodeArk(host.homedir, host.env, host.executableArgs)
    if (result.status === 'corrupt') return installation(clientId, 'unavailable', result.error)
    return detectOpenCode(host)
  }
  return addCliClient(host, clientId)
}

export async function removeMcpClient(
  host: McpClientHost,
  clientId: McpClientId,
): Promise<McpClientInstallation> {
  if (clientId === 'cursor') {
    const result = await removeCursorArk(host.homedir)
    if (result.status === 'corrupt') return installation(clientId, 'unavailable', result.error)
    return detectCursor(host)
  }
  if (clientId === 'openCode') {
    const result = await removeOpenCodeArk(host.homedir, host.env)
    if (result.status === 'corrupt') return installation(clientId, 'unavailable', result.error)
    return detectOpenCode(host)
  }
  return removeCliClient(host, clientId)
}

export function updateMcpClient(
  host: McpClientHost,
  clientId: McpClientId,
): Promise<McpClientInstallation> {
  return addMcpClient(host, clientId)
}
