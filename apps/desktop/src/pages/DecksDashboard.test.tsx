import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { writeChatSession } from '@/lib/chat/chat-session'
import { getTestLocalStorage } from '@/test/storage'

import { DecksDashboard } from './DecksDashboard'
import { toast } from 'sonner'

const deckApiMocks = vi.hoisted(() => ({
  createDeck: vi.fn(),
  deleteDeck: vi.fn(),
  importPptx: vi.fn(),
  listDecks: vi.fn(),
  removeRecentWorkspace: vi.fn(),
  renameDeck: vi.fn(),
}))

const useDeckThumbnailsMock = vi.hoisted(() =>
  vi.fn(() => ({
    status: null,
    thumbnailUrls: null,
    error: null,
    isLoading: false,
  })),
)

const missingDeck = {
  id: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
  title: 'Missing deck',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
  documentRevision: null,
  filePath: '/tmp/missing.ark',
  missing: true,
}

vi.mock('@/lib/api/deck-api', () => deckApiMocks)

vi.mock('@/hooks/useDeckThumbnails', () => ({
  useDeckThumbnails: useDeckThumbnailsMock,
}))

vi.mock('@/hooks/useAppearance', () => ({
  useAppearance: () => ({
    preference: 'system',
    resolvedAppearance: 'light',
    setPreference: vi.fn(),
  }),
}))

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
}))

describe('DecksDashboard', () => {
  beforeEach(() => {
    deckApiMocks.listDecks.mockResolvedValue([])
    deckApiMocks.importPptx.mockReset()
    deckApiMocks.createDeck.mockReset()
    deckApiMocks.removeRecentWorkspace.mockReset()
    deckApiMocks.removeRecentWorkspace.mockResolvedValue(undefined)
    window.arkDesktop = {
      mcp: window.arkDesktop.mcp,
      credentials: {
        list: vi.fn().mockResolvedValue({
          openai: { configured: false, storage: null },
          anthropic: { configured: false, storage: null },
          google: { configured: false, storage: null },
        }),
        save: vi.fn(),
        saveSession: vi.fn(),
        remove: vi.fn(),
        test: vi.fn(),
      },
      settings: {
        get: vi.fn().mockResolvedValue({ defaultWorkspaceDirectory: null }),
        update: vi.fn(),
      },
      updates: { check: vi.fn() },
      export: { create: vi.fn() },
      files: {
        openWorkspace: vi.fn(),
        chooseWorkspacePath: vi.fn(),
        chooseDirectory: vi.fn(),
        reveal: vi.fn(),
      },
    }
  })

  it('opens Settings from the dashboard', async () => {
    render(
      <MemoryRouter initialEntries={['/decks']}>
        <Routes>
          <Route element={<DecksDashboard />} path="/decks" />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByText('No decks yet')
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Appearance')).toBeInTheDocument()
  })

  it('starts a fresh local session when creating a new deck', async () => {
    writeChatSession(null, {
      messages: [
        { id: 'prompt-old', role: 'user', content: 'Build the old deck' },
        {
          id: 'assistant-old',
          role: 'assistant',
          content: '',
          parts: [
            { type: 'thinking', content: 'Old reasoning trace' },
            { type: 'tool-call', toolName: 'write_deck', summary: 'Writing the old deck' },
          ],
        },
      ],
      updatedAt: '2026-07-30T00:00:00.000Z',
    })
    getTestLocalStorage().setItem('ark:generation-job:new', 'job-old')

    render(
      <MemoryRouter initialEntries={['/decks']}>
        <Routes>
          <Route element={<DecksDashboard />} path="/decks" />
          <Route element={<div>Fresh deck</div>} path="/" />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByText('No decks yet')
    fireEvent.click(screen.getAllByRole('button', { name: 'New deck' })[0]!)

    expect(await screen.findByText('Fresh deck')).toBeInTheDocument()
    expect(getTestLocalStorage().getItem('ark:chat-session:new')).toBeNull()
    expect(getTestLocalStorage().getItem('ark:generation-job:new')).toBeNull()
  })

  it('opens a deck from anywhere on its card', async () => {
    deckApiMocks.listDecks.mockResolvedValue([
      {
        id: 'deck-1',
        title: 'Roadmap',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-02T00:00:00.000Z',
        documentRevision: 1,
        filePath: '/tmp/roadmap.ark',
      },
    ])

    render(
      <MemoryRouter initialEntries={['/decks']}>
        <Routes>
          <Route element={<DecksDashboard />} path="/decks" />
          <Route element={<div>Opened deck</div>} path="/decks/:deckId" />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('link', { name: 'Open Roadmap' }))

    expect(await screen.findByText('Opened deck')).toBeInTheDocument()
  })

  it('removes a missing workspace from the recent list', async () => {
    deckApiMocks.listDecks.mockResolvedValue([missingDeck])

    render(
      <MemoryRouter initialEntries={['/decks']}>
        <Routes>
          <Route element={<DecksDashboard />} path="/decks" />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(deckApiMocks.removeRecentWorkspace).toHaveBeenCalledWith(missingDeck.id)
      expect(screen.queryByText('File not found')).not.toBeInTheDocument()
    })
    expect(await screen.findByText('No decks yet')).toBeInTheDocument()
  })

  it('reports a failed missing-workspace removal', async () => {
    deckApiMocks.listDecks.mockResolvedValue([missingDeck])
    deckApiMocks.removeRecentWorkspace.mockRejectedValueOnce(new Error('Request failed'))

    render(
      <MemoryRouter initialEntries={['/decks']}>
        <Routes>
          <Route element={<DecksDashboard />} path="/decks" />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Could not remove recent workspace')
    })
    expect(screen.getByText('File not found')).toBeInTheDocument()
  })

  it('imports a PowerPoint file into a new workspace', async () => {
    deckApiMocks.importPptx.mockResolvedValue({
      id: 'imported-1',
      title: 'Imported Board',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
      documentRevision: 1,
      origin: 'authored',
      filePath: '/tmp/Imported Board.ark',
    })

    render(
      <MemoryRouter initialEntries={['/decks']}>
        <Routes>
          <Route element={<DecksDashboard />} path="/decks" />
          <Route element={<div>Imported deck</div>} path="/decks/:deckId" />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByText('No decks yet')
    const input = document.querySelector(
      'input[accept=".pptx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation"]',
    )
    expect(input).toBeTruthy()
    const file = new File(['pk'], 'board.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } })

    expect(await screen.findByText('Imported deck')).toBeInTheDocument()
    expect(deckApiMocks.importPptx).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'board.pptx', bytes: expect.any(String) }),
    )
    expect(deckApiMocks.createDeck).not.toHaveBeenCalled()
  })

  it('rejects legacy .ppt files before calling the API', async () => {
    render(
      <MemoryRouter initialEntries={['/decks']}>
        <Routes>
          <Route element={<DecksDashboard />} path="/decks" />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByText('No decks yet')
    const input = document.querySelector(
      'input[accept=".pptx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation"]',
    )
    const file = new File(['ole'], 'old.ppt', { type: 'application/vnd.ms-powerpoint' })
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } })

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Legacy .ppt files are not supported. Save the deck as .pptx and import it again.',
      )
    })
    expect(deckApiMocks.importPptx).not.toHaveBeenCalled()
  })
})
