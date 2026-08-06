import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { writeChatSession } from '@/lib/chat-session'
import { getTestLocalStorage } from '@/test/storage'

import { DecksDashboard } from './DecksDashboard'

const deckApiMocks = vi.hoisted(() => ({
  createDeck: vi.fn(),
  deleteDeck: vi.fn(),
  listDecks: vi.fn(),
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

vi.mock('@/lib/deck-api', () => deckApiMocks)

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
  },
}))

describe('DecksDashboard', () => {
  beforeEach(() => {
    deckApiMocks.listDecks.mockResolvedValue([])
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
          <Route element={<div>Fresh deck</div>} path="/decks/new" />
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
})
