import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  cursorConfigPath,
  mergeCursorArk,
  mergeOpenCodeArk,
  openCodeConfigDirectory,
  readCursorConfig,
  readOpenCodeConfig,
  removeCursorArk,
  removeOpenCodeArk,
} from './mcp-client-config.ts'

const executableArgs = ['/Applications/Ark.app/Contents/MacOS/Ark', '--headless', '--mcp']

describe('MCP client config file merge', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('adds and removes Cursor ark while preserving sibling servers', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-mcp-cursor-'))
    const filePath = cursorConfigPath(root)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          mcpServers: {
            github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
          },
        },
        null,
        2,
      )}\n`,
    )

    await expect(mergeCursorArk(root, executableArgs)).resolves.toMatchObject({ status: 'ok' })
    const added = JSON.parse(await readFile(filePath, 'utf8')) as {
      mcpServers: Record<string, unknown>
    }
    expect(added.mcpServers.github).toEqual({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    })
    expect(added.mcpServers.ark).toEqual({
      type: 'stdio',
      command: executableArgs[0],
      args: ['--headless', '--mcp'],
    })

    await expect(removeCursorArk(root)).resolves.toMatchObject({ status: 'ok' })
    const removed = JSON.parse(await readFile(filePath, 'utf8')) as {
      mcpServers: Record<string, unknown>
    }
    expect(removed.mcpServers.ark).toBeUndefined()
    expect(removed.mcpServers.github).toEqual({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    })
  })

  it('creates a missing Cursor config and treats a missing file as not present', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-mcp-cursor-missing-'))
    await expect(readCursorConfig(root)).resolves.toMatchObject({ kind: 'missing' })
    await expect(mergeCursorArk(root, executableArgs)).resolves.toMatchObject({ status: 'ok' })
    await expect(readCursorConfig(root)).resolves.toMatchObject({ kind: 'ok' })
  })

  it('refuses to overwrite a corrupt Cursor config', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-mcp-cursor-corrupt-'))
    const filePath = cursorConfigPath(root)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, '{ not json')
    await expect(mergeCursorArk(root, executableArgs)).resolves.toMatchObject({ status: 'corrupt' })
    await expect(removeCursorArk(root)).resolves.toMatchObject({ status: 'corrupt' })
    expect(await readFile(filePath, 'utf8')).toBe('{ not json')
  })

  it('adds OpenCode ark, preserves comments and siblings, then removes only ark', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-mcp-opencode-'))
    const env = { XDG_CONFIG_HOME: path.join(root, 'xdg') }
    const filePath = path.join(openCodeConfigDirectory(root, env), 'opencode.jsonc')
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(
      filePath,
      `{
  // keep this comment
  "mcp": {
    "other": {
      "type": "local",
      "command": ["echo"],
      "enabled": true
    }
  }
}
`,
    )

    await expect(mergeOpenCodeArk(root, env, executableArgs)).resolves.toMatchObject({
      status: 'ok',
    })
    const added = await readFile(filePath, 'utf8')
    expect(added).toContain('keep this comment')
    expect(added).toContain('"other"')
    expect(added).toContain('"ark"')
    expect(JSON.stringify(JSON.parse(added.replace(/\/\/[^\n]*/g, '')))).toContain(
      executableArgs[0],
    )

    const parsed = await readOpenCodeConfig(root, env)
    expect(parsed.kind).toBe('ok')

    await expect(removeOpenCodeArk(root, env)).resolves.toMatchObject({ status: 'ok' })
    const removed = await readFile(filePath, 'utf8')
    expect(removed).toContain('keep this comment')
    expect(removed).toContain('"other"')
    expect(removed).not.toMatch(/"ark"\s*:/)
  })

  it('writes OpenCode .json in place when that file already exists', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-mcp-opencode-json-'))
    const env = { XDG_CONFIG_HOME: path.join(root, 'xdg') }
    const filePath = path.join(openCodeConfigDirectory(root, env), 'opencode.json')
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify({ $schema: 'https://opencode.ai/config.json' })}\n`)
    await expect(mergeOpenCodeArk(root, env, executableArgs)).resolves.toMatchObject({
      status: 'ok',
      filePath,
    })
    const written = JSON.parse(await readFile(filePath, 'utf8')) as {
      $schema: string
      mcp: { ark: { command: string[] } }
    }
    expect(written.$schema).toBe('https://opencode.ai/config.json')
    expect(written.mcp.ark.command).toEqual(executableArgs)
  })

  it('refuses to overwrite a corrupt OpenCode config', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-mcp-opencode-corrupt-'))
    const env = { XDG_CONFIG_HOME: path.join(root, 'xdg') }
    const filePath = path.join(openCodeConfigDirectory(root, env), 'opencode.jsonc')
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, '{ not jsonc')
    await expect(mergeOpenCodeArk(root, env, executableArgs)).resolves.toMatchObject({
      status: 'corrupt',
    })
    expect(await readFile(filePath, 'utf8')).toBe('{ not jsonc')
  })
})
