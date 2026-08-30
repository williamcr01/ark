import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  mcpDiscoveryPath,
  readMcpDiscovery,
  removeMcpDiscovery,
  writeMcpDiscovery,
} from './discovery.ts'

describe('MCP discovery', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('atomically writes a user-only record and removes it', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-mcp-discovery-'))
    const filePath = mcpDiscoveryPath(root)
    const record = {
      schemaVersion: 1 as const,
      apiOrigin: 'http://127.0.0.1:49152',
      pid: process.pid,
      sessionCapability: 'x'.repeat(32),
      startedAt: '2026-08-06T12:00:00.000Z',
    }
    await writeMcpDiscovery(filePath, record)

    await expect(readMcpDiscovery(filePath)).resolves.toEqual(record)
    if (process.platform !== 'win32') {
      expect((await stat(filePath)).mode & 0o777).toBe(0o600)
    }
    await removeMcpDiscovery(filePath)
    await expect(readMcpDiscovery(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(removeMcpDiscovery(filePath)).resolves.toBeUndefined()
  })
})
