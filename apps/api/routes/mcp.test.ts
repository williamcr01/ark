import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../app.ts'
import { createDeckStore } from '@ark/storage/stores/deck-store.ts'
import { createMcpServiceState } from '../mcp-service.ts'
import { createWorkspaceStore, type WorkspaceStore } from '@ark/storage/stores/workspace-store.ts'

const html = `<!DOCTYPE html><html><head><title>Route Deck</title></head><body><section class="slide"><h1>One</h1></section></body></html>`

describe('internal MCP route', () => {
  let root = ''
  let workspaces: WorkspaceStore | null = null
  let server: Server | null = null

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
    workspaces?.close()
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('requires the current capability and rejects browser origins', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-mcp-route-'))
    workspaces = createWorkspaceStore(root)
    const deckStore = createDeckStore(workspaces)
    const deck = await deckStore.createDeck(html)
    const state = createMcpServiceState()
    const capability = 'c'.repeat(32)
    state.start(capability)
    state.setActiveDeck(deck.id)
    const onMcpActivity = vi.fn()
    const app = createApp({
      deckStore,
      workspaceStore: workspaces,
      mcpServiceState: state,
      onMcpActivity,
    })
    server = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server!.once('listening', resolve))
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const url = `${origin}/api/internal/mcp/tools/get_active_deck`
    const body = JSON.stringify({ arguments: {}, client: { name: 'Codex' } })

    expect(
      (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }))
        .status,
    ).toBe(401)
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${capability}`,
            'Content-Type': 'application/json',
            Origin: 'https://example.com',
          },
          body,
        })
      ).status,
    ).toBe(403)

    const authorized = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${capability}`, 'Content-Type': 'application/json' },
      body,
    })
    expect(authorized.status).toBe(200)
    await expect(authorized.json()).resolves.toMatchObject({
      structuredContent: { deckId: deck.id, documentRevision: 1 },
    })
    expect(onMcpActivity).toHaveBeenCalledWith(
      expect.objectContaining({ clientName: 'Codex', toolName: 'get_active_deck', failed: false }),
    )

    state.stop()
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${capability}`, 'Content-Type': 'application/json' },
          body,
        })
      ).status,
    ).toBe(401)
  })
})
