import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDeckStore } from './deck-store.ts'
import { createMcpRunner, McpRunnerError } from './mcp-runner.ts'
import { createMcpServiceState } from './mcp-service.ts'
import { createWorkspaceStore, type WorkspaceStore } from './workspace-store.ts'

const html = `<!DOCTYPE html><html><head><title>MCP Deck</title></head><body><section class="slide"><h1>Opening</h1></section></body></html>`

describe('MCP runner', () => {
  let root = ''
  let workspaces: WorkspaceStore | null = null

  afterEach(async () => {
    workspaces?.close()
    if (root) await rm(root, { recursive: true, force: true })
  })

  async function setup() {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-mcp-runner-'))
    workspaces = createWorkspaceStore(root)
    const deckStore = createDeckStore(workspaces)
    const deck = await deckStore.createDeck(html)
    const state = createMcpServiceState()
    state.start('x'.repeat(32))
    state.setActiveDeck(deck.id)
    const onExternalDeckUpdate = vi.fn()
    return {
      deck,
      deckStore,
      state,
      onExternalDeckUpdate,
      run: createMcpRunner({ deckStore, state, onExternalDeckUpdate }),
    }
  }

  it('reads and mutates only the active deck with a revision envelope', async () => {
    const { deck, deckStore, run, onExternalDeckUpdate } = await setup()
    await expect(run('get_active_deck', {}, 'Codex')).resolves.toMatchObject({
      structuredContent: {
        deckId: deck.id,
        documentRevision: 1,
        slideCount: 1,
      },
    })

    await expect(
      run(
        'patch_deck',
        {
          deckId: deck.id,
          expectedDocumentRevision: 1,
          operations: [{ op: 'update_slide_title', slideIndex: 0, title: 'Sharper opening' }],
        },
        'Codex',
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        deckId: deck.id,
        previousDocumentRevision: 1,
        documentRevision: 2,
      },
    })
    await expect(deckStore.getDeck(deck.id)).resolves.toMatchObject({
      documentRevision: 2,
      html: expect.stringContaining('Sharper opening'),
    })
    expect(onExternalDeckUpdate).toHaveBeenCalledOnce()
  })

  it('returns recoverable errors for stale, inactive, and disabled access', async () => {
    const { deck, run, state } = await setup()
    await expect(
      run(
        'edit_deck',
        {
          deckId: deck.id,
          expectedDocumentRevision: 2,
          edits: [{ oldText: 'Opening', newText: 'Nope' }],
        },
        null,
      ),
    ).rejects.toMatchObject({ code: 'DOCUMENT_CONFLICT', status: 409 })

    state.setActiveDeck(null)
    await expect(run('get_active_deck', {}, null)).rejects.toMatchObject({
      code: 'NO_ACTIVE_DECK',
    })

    state.stop()
    await expect(run('get_active_deck', {}, null)).rejects.toBeInstanceOf(McpRunnerError)
    await expect(run('get_active_deck', {}, null)).rejects.toMatchObject({ code: 'MCP_DISABLED' })
  })

  it('does not persist invalid full-document writes', async () => {
    const { deck, deckStore, run } = await setup()
    const result = await run(
      'write_deck',
      {
        deckId: deck.id,
        expectedDocumentRevision: 1,
        html: '<html><body><img src="https://example.com/image.png"></body></html>',
      },
      null,
    )
    expect(result.isError).toBe(true)
    await expect(deckStore.getDeck(deck.id)).resolves.toMatchObject({
      documentRevision: 1,
      html,
    })
  })

  it('does not commit after MCP stops or the active deck changes in flight', async () => {
    const stopped = await setup()
    const originalStoppedGet = stopped.deckStore.getDeck.bind(stopped.deckStore)
    stopped.deckStore.getDeck = vi.fn(async (id) => {
      const deck = await originalStoppedGet(id)
      stopped.state.stop()
      return deck
    })
    await expect(
      stopped.run(
        'edit_deck',
        {
          deckId: stopped.deck.id,
          expectedDocumentRevision: 1,
          edits: [{ oldText: 'Opening', newText: 'Stopped' }],
        },
        null,
      ),
    ).rejects.toMatchObject({ code: 'MCP_DISABLED' })

    stopped.state.start('y'.repeat(32))
    stopped.state.setActiveDeck(stopped.deck.id)
    const originalActiveGet = originalStoppedGet
    stopped.deckStore.getDeck = vi.fn(async (id) => {
      const deck = await originalActiveGet(id)
      stopped.state.setActiveDeck(null)
      return deck
    })
    await expect(
      stopped.run(
        'edit_deck',
        {
          deckId: stopped.deck.id,
          expectedDocumentRevision: 1,
          edits: [{ oldText: 'Opening', newText: 'Switched' }],
        },
        null,
      ),
    ).rejects.toMatchObject({ code: 'DECK_NOT_ACTIVE' })
    await expect(originalStoppedGet(stopped.deck.id)).resolves.toMatchObject({
      documentRevision: 1,
      html,
    })
  })
})
