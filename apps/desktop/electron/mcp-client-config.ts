import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser'

import type { ArkServerInvocation } from './mcp-client-status.ts'
import { MCP_HEADLESS_FLAG, MCP_SERVER_FLAG, MCP_SERVER_NAME } from './mcp-client-status.ts'

export type JsonFileRead<T> =
  | { kind: 'missing' }
  | { kind: 'corrupt'; error: string }
  | { kind: 'ok'; value: T; text: string; filePath: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseJsonDocument(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

export function parseJsoncDocument(text: string): { ok: true; value: unknown } | { ok: false } {
  const errors: ParseError[] = []
  const value = parse(text, errors, { allowTrailingComma: true, allowEmptyContent: false })
  if (errors.length > 0) return { ok: false }
  return { ok: true, value }
}

export function applyJsoncEdit(
  text: string,
  jsonPath: Array<string | number>,
  value: unknown,
): string {
  const edits = modify(text, jsonPath, value, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  return applyEdits(text, edits)
}

export async function atomicWriteFile(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8' })
    await rename(temporaryPath, filePath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

async function readExistingFile(
  filePath: string,
): Promise<{ kind: 'missing' } | { kind: 'ok'; text: string }> {
  try {
    return { kind: 'ok', text: await readFile(filePath, 'utf8') }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { kind: 'missing' }
    }
    throw error
  }
}

export function cursorConfigPath(homedir: string): string {
  return path.join(homedir, '.cursor', 'mcp.json')
}

export function openCodeConfigDirectory(homedir: string, env: NodeJS.ProcessEnv): string {
  // OpenCode uses XDG_CONFIG_HOME ?? ~/.config on every platform, including
  // macOS and Windows — not Application Support or %APPDATA%.
  const xdg = env.XDG_CONFIG_HOME?.trim()
  return path.join(xdg && xdg.length > 0 ? xdg : path.join(homedir, '.config'), 'opencode')
}

export async function resolveOpenCodeConfigPath(
  homedir: string,
  env: NodeJS.ProcessEnv,
): Promise<{ filePath: string; exists: boolean; jsonc: boolean }> {
  const directory = openCodeConfigDirectory(homedir, env)
  const jsoncPath = path.join(directory, 'opencode.jsonc')
  const jsonPath = path.join(directory, 'opencode.json')
  const jsonc = await readExistingFile(jsoncPath)
  if (jsonc.kind === 'ok') return { filePath: jsoncPath, exists: true, jsonc: true }
  const json = await readExistingFile(jsonPath)
  if (json.kind === 'ok') return { filePath: jsonPath, exists: true, jsonc: false }
  return { filePath: jsoncPath, exists: false, jsonc: true }
}

export async function readCursorConfig(
  homedir: string,
): Promise<JsonFileRead<Record<string, unknown>>> {
  const filePath = cursorConfigPath(homedir)
  const existing = await readExistingFile(filePath)
  if (existing.kind === 'missing') return { kind: 'missing' }
  const parsed = parseJsonDocument(existing.text)
  if (!parsed.ok || !isRecord(parsed.value)) {
    return {
      kind: 'corrupt',
      error: `Cursor MCP config is unreadable. Fix ${filePath} and try again.`,
    }
  }
  return { kind: 'ok', value: parsed.value, text: existing.text, filePath }
}

export async function readOpenCodeConfig(
  homedir: string,
  env: NodeJS.ProcessEnv,
): Promise<JsonFileRead<Record<string, unknown>> & { jsonc?: boolean }> {
  const resolved = await resolveOpenCodeConfigPath(homedir, env)
  if (!resolved.exists) return { kind: 'missing' }
  const existing = await readExistingFile(resolved.filePath)
  if (existing.kind === 'missing') return { kind: 'missing' }
  const parsed = resolved.jsonc
    ? parseJsoncDocument(existing.text)
    : parseJsonDocument(existing.text)
  if (!parsed.ok || !isRecord(parsed.value)) {
    return {
      kind: 'corrupt',
      error: `OpenCode config is unreadable. Fix ${resolved.filePath} and try again.`,
    }
  }
  return {
    kind: 'ok',
    value: parsed.value,
    text: existing.text,
    filePath: resolved.filePath,
    jsonc: resolved.jsonc,
  }
}

export function cursorArkInvocation(
  config: Record<string, unknown>,
): ArkServerInvocation | 'corrupt' {
  if (!('mcpServers' in config) || config.mcpServers === undefined) return { present: false }
  if (!isRecord(config.mcpServers)) return 'corrupt'
  const entry = config.mcpServers[MCP_SERVER_NAME]
  if (entry === undefined) return { present: false }
  if (!isRecord(entry)) return { present: true }
  const command = typeof entry.command === 'string' ? entry.command : undefined
  const args = Array.isArray(entry.args)
    ? entry.args.filter((value): value is string => typeof value === 'string')
    : []
  return { present: true, command, args }
}

export function openCodeArkInvocation(
  config: Record<string, unknown>,
): ArkServerInvocation | 'corrupt' {
  if (!('mcp' in config) || config.mcp === undefined) return { present: false }
  if (!isRecord(config.mcp)) return 'corrupt'
  const entry = config.mcp[MCP_SERVER_NAME]
  if (entry === undefined) return { present: false }
  if (!isRecord(entry)) return { present: true }
  if (Array.isArray(entry.command) && entry.command.every((value) => typeof value === 'string')) {
    const [command, ...args] = entry.command
    return { present: true, command, args }
  }
  return { present: true }
}

export function cursorArkEntry(executableArgs: string[]): Record<string, unknown> {
  const [command, ...args] = executableArgs
  return {
    type: 'stdio',
    command,
    args: args.length > 0 ? args : [MCP_HEADLESS_FLAG, MCP_SERVER_FLAG],
  }
}

export function openCodeArkEntry(executableArgs: string[]): Record<string, unknown> {
  return {
    type: 'local',
    command: [...executableArgs],
    enabled: true,
  }
}

export async function mergeCursorArk(
  homedir: string,
  executableArgs: string[],
): Promise<{ status: 'ok'; filePath: string } | { status: 'corrupt'; error: string }> {
  const filePath = cursorConfigPath(homedir)
  const existing = await readCursorConfig(homedir)
  if (existing.kind === 'corrupt') return { status: 'corrupt', error: existing.error }
  if (existing.kind === 'ok' && cursorArkInvocation(existing.value) === 'corrupt') {
    return {
      status: 'corrupt',
      error: `Cursor MCP config is unreadable. Fix ${filePath} and try again.`,
    }
  }

  const next =
    existing.kind === 'missing'
      ? `${JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: cursorArkEntry(executableArgs) } }, null, 2)}\n`
      : applyJsoncEdit(
          existing.text,
          ['mcpServers', MCP_SERVER_NAME],
          cursorArkEntry(executableArgs),
        )
  await atomicWriteFile(filePath, next.endsWith('\n') ? next : `${next}\n`)
  return { status: 'ok', filePath }
}

export async function removeCursorArk(
  homedir: string,
): Promise<{ status: 'ok' | 'missing'; filePath: string } | { status: 'corrupt'; error: string }> {
  const existing = await readCursorConfig(homedir)
  const filePath = cursorConfigPath(homedir)
  if (existing.kind === 'missing') return { status: 'missing', filePath }
  if (existing.kind === 'corrupt') return { status: 'corrupt', error: existing.error }
  if (cursorArkInvocation(existing.value) === 'corrupt') {
    return {
      status: 'corrupt',
      error: `Cursor MCP config is unreadable. Fix ${filePath} and try again.`,
    }
  }
  if (!isRecord(existing.value.mcpServers) || !(MCP_SERVER_NAME in existing.value.mcpServers)) {
    return { status: 'ok', filePath }
  }
  const next = applyJsoncEdit(existing.text, ['mcpServers', MCP_SERVER_NAME], undefined)
  await atomicWriteFile(filePath, next.endsWith('\n') ? next : `${next}\n`)
  return { status: 'ok', filePath }
}

export async function mergeOpenCodeArk(
  homedir: string,
  env: NodeJS.ProcessEnv,
  executableArgs: string[],
): Promise<{ status: 'ok'; filePath: string } | { status: 'corrupt'; error: string }> {
  const [resolved, existing] = await Promise.all([
    resolveOpenCodeConfigPath(homedir, env),
    readOpenCodeConfig(homedir, env),
  ])
  if (existing.kind === 'corrupt') return { status: 'corrupt', error: existing.error }
  if (existing.kind === 'ok' && openCodeArkInvocation(existing.value) === 'corrupt') {
    return {
      status: 'corrupt',
      error: `OpenCode config is unreadable. Fix ${existing.filePath} and try again.`,
    }
  }

  const filePath = existing.kind === 'ok' ? existing.filePath : resolved.filePath
  const next =
    existing.kind === 'missing'
      ? `${JSON.stringify({ mcp: { [MCP_SERVER_NAME]: openCodeArkEntry(executableArgs) } }, null, 2)}\n`
      : applyJsoncEdit(existing.text, ['mcp', MCP_SERVER_NAME], openCodeArkEntry(executableArgs))
  await atomicWriteFile(filePath, next.endsWith('\n') ? next : `${next}\n`)
  return { status: 'ok', filePath }
}

export async function removeOpenCodeArk(
  homedir: string,
  env: NodeJS.ProcessEnv,
): Promise<{ status: 'ok' | 'missing'; filePath: string } | { status: 'corrupt'; error: string }> {
  const [existing, resolved] = await Promise.all([
    readOpenCodeConfig(homedir, env),
    resolveOpenCodeConfigPath(homedir, env),
  ])
  if (existing.kind === 'missing') return { status: 'missing', filePath: resolved.filePath }
  if (existing.kind === 'corrupt') return { status: 'corrupt', error: existing.error }
  if (openCodeArkInvocation(existing.value) === 'corrupt') {
    return {
      status: 'corrupt',
      error: `OpenCode config is unreadable. Fix ${existing.filePath} and try again.`,
    }
  }
  if (!isRecord(existing.value.mcp) || !(MCP_SERVER_NAME in existing.value.mcp)) {
    return { status: 'ok', filePath: existing.filePath }
  }
  const next = applyJsoncEdit(existing.text, ['mcp', MCP_SERVER_NAME], undefined)
  await atomicWriteFile(existing.filePath, next.endsWith('\n') ? next : `${next}\n`)
  return { status: 'ok', filePath: existing.filePath }
}
