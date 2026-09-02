import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  extraCliSearchDirectories,
  resolveCliBinary,
  type McpClientHost,
} from './mcp-client-cli.ts'
import {
  addMcpClient,
  getMcpClientInstallations,
  removeMcpClient,
  updateMcpClient,
} from './mcp-client-installations.ts'
import { cursorConfigPath } from './mcp-client-config.ts'

const executableArgs = ['/opt/Ark/ark', '--headless', '--mcp']

function host(overrides: Partial<McpClientHost> & Pick<McpClientHost, 'homedir'>): McpClientHost {
  return {
    executableArgs,
    env: overrides.env ?? {},
    platform: overrides.platform ?? 'linux',
    resolveBinary: overrides.resolveBinary ?? (async () => null),
    runCli: overrides.runCli,
    ...overrides,
  }
}

describe('MCP client CLI path resolution', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('finds a binary on PATH and in extra install locations', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-mcp-cli-path-'))
    const pathDir = path.join(root, 'path-bin')
    const extraDir = path.join(root, '.local', 'bin')
    await mkdir(pathDir, { recursive: true })
    await mkdir(extraDir, { recursive: true })
    const onPath = path.join(pathDir, 'codex')
    const extra = path.join(extraDir, 'claude')
    await writeFile(onPath, '#!/bin/sh\n')
    await writeFile(extra, '#!/bin/sh\n')
    await chmod(onPath, 0o755)
    await chmod(extra, 0o755)

    await expect(
      resolveCliBinary('codex', {
        homedir: root,
        env: { PATH: pathDir },
        platform: 'linux',
      }),
    ).resolves.toBe(onPath)

    await expect(
      resolveCliBinary('claude', {
        homedir: root,
        env: { PATH: '' },
        platform: 'linux',
      }),
    ).resolves.toBe(extra)
  })

  it('lists Windows extra search directories from AppData and Program Files', () => {
    const dirs = extraCliSearchDirectories('win32', 'C:\\Users\\sam', {
      LOCALAPPDATA: 'C:\\Users\\sam\\AppData\\Local',
      APPDATA: 'C:\\Users\\sam\\AppData\\Roaming',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    })
    expect(dirs).toContain('C:\\Users\\sam\\AppData\\Roaming\\npm')
    expect(dirs).toContain('C:\\Program Files\\nodejs')
  })
})

describe('MCP client installations', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('returns unavailable for missing CLI binaries instead of throwing', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-mcp-install-'))
    const installations = await getMcpClientInstallations(host({ homedir: root }))
    const byId = Object.fromEntries(installations.map((entry) => [entry.clientId, entry]))
    expect(byId.codex).toMatchObject({
      status: 'unavailable',
      error: 'Install Codex CLI to connect it to Ark.',
    })
    expect(byId.claudeCode).toMatchObject({ status: 'unavailable' })
    expect(byId.grok).toMatchObject({ status: 'unavailable' })
    expect(byId.devinCli).toMatchObject({ status: 'unavailable' })
    expect(byId.cursor).toMatchObject({ status: 'notInstalled' })
    expect(byId.openCode).toMatchObject({ status: 'notInstalled' })
    await expect(addMcpClient(host({ homedir: root }), 'codex')).resolves.toMatchObject({
      status: 'unavailable',
      error: 'Install Codex CLI to connect it to Ark.',
    })
  })

  it('adds, detects needsUpdate, updates, and removes a Cursor installation', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-mcp-install-cursor-'))
    const cursorHost = host({ homedir: root })
    await expect(addMcpClient(cursorHost, 'cursor')).resolves.toMatchObject({ status: 'installed' })

    const filePath = cursorConfigPath(root)
    const current = JSON.parse(await readFile(filePath, 'utf8')) as {
      mcpServers: { ark: { command: string } }
    }
    current.mcpServers.ark.command = '/old/Ark'
    await writeFile(filePath, `${JSON.stringify(current, null, 2)}\n`)
    await expect(getMcpClientInstallations(cursorHost)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientId: 'cursor', status: 'needsUpdate' }),
      ]),
    )

    await expect(updateMcpClient(cursorHost, 'cursor')).resolves.toMatchObject({
      status: 'installed',
    })
    await expect(removeMcpClient(cursorHost, 'cursor')).resolves.toMatchObject({
      status: 'notInstalled',
    })
  })

  it('runs CLI add/remove with argument arrays and classifies list output', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-mcp-install-cli-'))
    const calls: string[][] = []
    let present = false
    const cliHost = host({
      homedir: root,
      resolveBinary: async () => '/usr/local/bin/codex',
      runCli: async (_bin, args) => {
        calls.push(args)
        if (args[1] === 'add') {
          present = true
          return { code: 0, stdout: '', stderr: '' }
        }
        if (args[1] === 'remove') {
          present = false
          return { code: 0, stdout: '', stderr: '' }
        }
        if (args[1] === 'get' || args[1] === 'list') {
          if (!present) return { code: 1, stdout: '', stderr: 'No MCP server named ark' }
          return {
            code: 0,
            stdout: JSON.stringify({
              name: 'ark',
              command: executableArgs[0],
              args: ['--headless', '--mcp'],
            }),
            stderr: '',
          }
        }
        return { code: 0, stdout: '', stderr: '' }
      },
    })

    await expect(addMcpClient(cliHost, 'codex')).resolves.toMatchObject({ status: 'installed' })
    expect(calls[0]).toEqual(['mcp', 'add', 'ark', '--', ...executableArgs])
    await expect(removeMcpClient(cliHost, 'codex')).resolves.toMatchObject({
      status: 'notInstalled',
    })
    expect(calls.some((args) => args[1] === 'remove')).toBe(true)
  })
})
