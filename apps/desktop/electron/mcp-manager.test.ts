import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMcpServiceState } from '@ark/api/mcp-service.ts'
import { createMcpInteractionStore } from '@ark/api/mcp-interactions.ts'
import { mcpDiscoveryPath, readMcpDiscovery } from '@ark/mcp/discovery.ts'
import { McpManager, resolveMcpExecutableArgs } from './mcp-manager.ts'

describe('MCP manager', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('rotates discovery, persists only autostart, and revokes before stopping', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-mcp-manager-'))
    const serviceState = createMcpServiceState()
    const interactionStore = createMcpInteractionStore()
    let autoStart = false
    const onStatusChanged = vi.fn()
    const manager = new McpManager({
      apiOrigin: 'http://127.0.0.1:49152',
      userDataDirectory: root,
      serviceState,
      interactionStore,
      getAutoStart: () => autoStart,
      setAutoStart: async (enabled) => {
        autoStart = enabled
      },
      executableArgs: ['/Applications/Ark.app/Contents/MacOS/Ark', '--headless', '--mcp'],
      onStatusChanged,
      onDeckUpdated: vi.fn(),
    })

    await manager.cleanupStartup()
    await manager.setAutoStart(true)
    const running = await manager.start()
    const discovery = await readMcpDiscovery(mcpDiscoveryPath(root))
    expect(running).toMatchObject({ state: 'running', autoStart: true })
    expect(JSON.stringify(running)).not.toContain(discovery.sessionCapability)
    expect(serviceState.authenticate(discovery.sessionCapability)).toBe(true)
    expect(manager.getSetupCommands().codex).toContain(
      '"/Applications/Ark.app/Contents/MacOS/Ark" --headless --mcp',
    )

    const deckId = '00000000-0000-4000-8000-000000000001'
    manager.setActiveDeck(deckId, 'Untitled Presentation', 1)
    const interaction = interactionStore.create(
      {
        deckId,
        baseDocumentRevision: 1,
        clientName: 'Codex',
        kind: 'questions',
        request: {
          title: 'One question',
          questions: [
            {
              id: 'audience',
              question: 'Who is this for?',
              type: 'text',
              required: true,
            },
          ],
        },
      },
      'session-a',
    )

    manager.recordActivity({
      clientName: '<script>Codex</script>',
      toolName: 'read_deck',
      summary: 'Read the visible deck.',
      occurredAt: '2026-08-06T12:00:00.000Z',
      failed: false,
    })
    expect(manager.getStatus()).toMatchObject({
      connectedClient: 'scriptCodexscript',
      lastActivity: { toolName: 'read_deck' },
    })

    const stopping = manager.stop()
    expect(serviceState.authenticate(discovery.sessionCapability)).toBe(false)
    await stopping
    await expect(interactionStore.wait(interaction.id, 'session-a', 0)).resolves.toMatchObject({
      status: 'canceled',
    })
    await expect(readMcpDiscovery(mcpDiscoveryPath(root))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(onStatusChanged).toHaveBeenCalled()
  })

  it('uses the stable AppImage path and keeps development entry arguments', () => {
    expect(
      resolveMcpExecutableArgs({
        isPackaged: true,
        execPath: '/tmp/.mount_Ark/ark',
        appPath: '/tmp/.mount_Ark/resources/app.asar',
        platform: 'linux',
        appImagePath: '/home/user/Applications/Ark.AppImage',
      }),
    ).toEqual(['/home/user/Applications/Ark.AppImage', '--headless', '--mcp'])
    expect(
      resolveMcpExecutableArgs({
        isPackaged: false,
        execPath: '/repo/node_modules/electron/dist/electron',
        appPath: '/repo/apps/desktop',
        platform: 'linux',
      }),
    ).toEqual([
      '/repo/node_modules/electron/dist/electron',
      '--headless',
      '/repo/apps/desktop',
      '--mcp',
    ])
  })
})
