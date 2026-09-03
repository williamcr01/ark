import { type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkspaceFileActions } from './useWorkspaceFileActions'
import { WorkspaceRuntimeContext, type WorkspaceRuntimeValue } from './workspace-runtime-context'

const { toast } = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => 'pending'),
  },
}))

vi.mock('sonner', () => ({ toast }))

const startNewDeck = vi.fn(async () => undefined)
const openWorkspaceFile = vi.fn()
const importPptx = vi.fn()

vi.mock('@/lib/api/deck-api', () => ({
  importPptx: (...args: unknown[]) => importPptx(...args),
  exportDeckHtml: vi.fn(),
}))

vi.mock('./useDeckActions', () => ({
  useDeckActions: () => ({
    handleNewDeck: startNewDeck,
    handleHtmlUpload: vi.fn(),
    handleUploadClick: vi.fn(),
    handleDownload: vi.fn(),
    handleRenameDeck: vi.fn(),
    handleDeleteDeck: vi.fn(),
  }),
}))

function wrapper({ children }: { children: ReactNode }) {
  const value = {
    persistence: {
      deckId: 'deck-1',
      deckTitle: 'Deck',
      html: '<html></html>',
      persistHtml: vi.fn(),
      startNewDeck,
      renameActiveDeck: vi.fn(),
      deleteActiveDeck: vi.fn(),
      openWorkspaceFile,
      saveAs: vi.fn(),
      moveTo: vi.fn(),
      duplicate: vi.fn(),
    },
    chat: {
      appendMessage: vi.fn(),
      setMessages: vi.fn(),
      resetChat: vi.fn(),
    },
    workspaceMode: 'editor',
  } as unknown as WorkspaceRuntimeValue
  return (
    <MemoryRouter>
      <WorkspaceRuntimeContext.Provider value={value}>{children}</WorkspaceRuntimeContext.Provider>
    </MemoryRouter>
  )
}

describe('useWorkspaceFileActions', () => {
  beforeEach(() => {
    startNewDeck.mockClear()
    openWorkspaceFile.mockReset()
    importPptx.mockReset()
  })
  it('starts a new deck and navigates home', async () => {
    const { result } = renderHook(() => useWorkspaceFileActions(), { wrapper })
    await act(async () => {
      await result.current.handleNewDeck()
    })
    expect(startNewDeck).toHaveBeenCalled()
  })

  it('opens a workspace file', async () => {
    window.arkDesktop.files.openWorkspace = vi.fn().mockResolvedValue('/tmp/Deck.ark')
    openWorkspaceFile.mockResolvedValue({ id: 'deck-9' })
    const { result } = renderHook(() => useWorkspaceFileActions(), { wrapper })
    await act(async () => {
      await result.current.handleOpenWorkspace()
    })
    expect(openWorkspaceFile).toHaveBeenCalledWith('/tmp/Deck.ark')
  })

  it('imports a pptx path chosen from the open dialog', async () => {
    window.arkDesktop.files.openWorkspace = vi.fn().mockResolvedValue('/tmp/talk.pptx')
    importPptx.mockResolvedValue({ id: 'deck-pptx' })
    const { result } = renderHook(() => useWorkspaceFileActions(), { wrapper })
    await act(async () => {
      await result.current.handleOpenWorkspace()
    })
    expect(importPptx).toHaveBeenCalledWith({ path: '/tmp/talk.pptx', filename: 'talk.pptx' })
    expect(toast.success).toHaveBeenCalled()
  })
})
