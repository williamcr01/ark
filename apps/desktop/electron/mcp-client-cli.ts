import { spawn, type ChildProcess } from 'node:child_process'
import { access, constants, stat } from 'node:fs/promises'
import path from 'node:path'

import { CLI_BINARIES, type McpCliClientId, clipErrorMessage } from './mcp-client-status.ts'

export type CliRunResult = {
  code: number | null
  stdout: string
  stderr: string
  error?: string
}

export type McpClientHost = {
  executableArgs: string[]
  homedir: string
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  runCli?: (absoluteBin: string, args: string[]) => Promise<CliRunResult>
  resolveBinary?: (binaryName: string) => Promise<string | null>
}

/**
 * Packaged Electron often inherits a GUI-launch PATH that omits Homebrew,
 * `~/.local/bin`, and other user install locations. Search PATH first, then
 * those well-known directories, instead of relying on `which`.
 */
export function extraCliSearchDirectories(
  platform: NodeJS.Platform,
  homedir: string,
  env: NodeJS.ProcessEnv,
): string[] {
  const join = platform === 'win32' ? path.win32.join : path.join
  const dirs = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(homedir, '.local', 'bin'),
    join(homedir, '.cargo', 'bin'),
  ]
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || join(homedir, 'AppData', 'Local')
    const appData = env.APPDATA || join(homedir, 'AppData', 'Roaming')
    const programFiles = env.ProgramFiles || 'C:\\Program Files'
    const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    dirs.push(
      join(localAppData, 'Programs'),
      join(localAppData, 'Microsoft', 'WinGet', 'Links'),
      join(appData, 'npm'),
      join(programFiles, 'nodejs'),
      join(programFilesX86, 'nodejs'),
    )
  }
  return dirs
}

export function binaryFileNames(binaryName: string, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') return [binaryName]
  const extensions = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return [
    ...extensions.map((ext) =>
      binaryName.toLowerCase().endsWith(ext.toLowerCase()) ? binaryName : `${binaryName}${ext}`,
    ),
    binaryName,
  ]
}

function pathDirectories(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const pathValue = env.PATH ?? env.Path ?? ''
  return pathValue.split(platform === 'win32' ? ';' : path.delimiter).filter(Boolean)
}

async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath)
    if (!info.isFile() && !info.isSymbolicLink()) return false
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function resolveCliBinary(
  binaryName: string,
  host: Pick<McpClientHost, 'homedir' | 'env' | 'platform' | 'resolveBinary'>,
): Promise<string | null> {
  if (host.resolveBinary) return host.resolveBinary(binaryName)

  const names = binaryFileNames(binaryName, host.platform)
  const seen = new Set<string>()
  const directories = [
    ...pathDirectories(host.env, host.platform),
    ...extraCliSearchDirectories(host.platform, host.homedir, host.env),
  ]

  for (const directory of directories) {
    for (const name of names) {
      const candidate = path.resolve(directory, name)
      const key = host.platform === 'win32' ? candidate.toLowerCase() : candidate
      if (seen.has(key)) continue
      seen.add(key)
      if (await isExecutableFile(candidate)) return candidate
    }
  }

  return null
}

function spawnCommand(
  absoluteBin: string,
  args: string[],
  platform: NodeJS.Platform,
  env?: NodeJS.ProcessEnv,
) {
  const spawnOptions = { shell: false as const, windowsHide: true, ...(env ? { env } : {}) }
  // `.cmd` shims cannot be spawned with `shell: false` on Windows. Pass the
  // resolved path and argument array through `cmd.exe` instead of interpolating
  // a shell string.
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(absoluteBin)) {
    const comspec = process.env.ComSpec || 'cmd.exe'
    return spawn(comspec, ['/d', '/s', '/c', absoluteBin, ...args], spawnOptions)
  }
  return spawn(absoluteBin, args, spawnOptions)
}

export function runCliProcess(
  absoluteBin: string,
  args: string[],
  options: { platform?: NodeJS.Platform; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<CliRunResult> {
  const timeoutMs = options.timeoutMs ?? 20_000
  const platform = options.platform ?? process.platform

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let child: ChildProcess
    try {
      child = spawnCommand(absoluteBin, args, platform, options.env)
    } catch (error) {
      resolve({
        code: -1,
        stdout: '',
        stderr: '',
        error: clipErrorMessage(error instanceof Error ? error.message : 'Could not start CLI.'),
      })
      return
    }

    const finish = (result: CliRunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish({
        code: -1,
        stdout,
        stderr,
        error: `Timed out after ${timeoutMs}ms.`,
      })
    }, timeoutMs)

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      finish({
        code: -1,
        stdout,
        stderr,
        error: clipErrorMessage(error.message),
      })
    })
    child.on('close', (code) => {
      finish({ code, stdout, stderr })
    })
  })
}

export async function runCli(
  host: McpClientHost,
  binaryName: string,
  args: string[],
): Promise<{ binary: string | null; result?: CliRunResult }> {
  const binary = await resolveCliBinary(binaryName, host)
  if (!binary) return { binary: null }
  const result = host.runCli
    ? await host.runCli(binary, args)
    : await runCliProcess(binary, args, { platform: host.platform, env: host.env })
  return { binary, result }
}

export function cliBinaryName(clientId: McpCliClientId): string {
  return CLI_BINARIES[clientId]
}
