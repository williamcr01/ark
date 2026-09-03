import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiResponseError } from '@ark/contracts'

import { DeckRestoreHistoryMenu } from './DeckRestoreHistoryMenu'

const listDocumentHistory = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api/deck-api', () => ({
  listDocumentHistory,
}))

const history = [
  {
    revision: 1,
    source: 'create' as const,
    createdAt: '2026-09-01T00:00:00.000Z',
    byteSize: 120,
  },
  {
    revision: 2,
    source: 'editor' as const,
    createdAt: '2026-09-01T00:01:00.000Z',
    byteSize: 240,
  },
]

function renderMenu(
  overrides: Partial<{
    onRestore: (revision: number) => Promise<void>
    disabled: boolean
  }> = {},
) {
  const onRestore = overrides.onRestore ?? vi.fn().mockResolvedValue(undefined)
  render(
    <TooltipProvider>
      <DeckRestoreHistoryMenu
        deckId="be4b3f4e-d05b-45d1-9da6-89d6df227b54"
        disabled={overrides.disabled}
        onRestore={onRestore}
      />
    </TooltipProvider>,
  )
  return { onRestore }
}

describe('DeckRestoreHistoryMenu', () => {
  beforeEach(() => {
    listDocumentHistory.mockReset()
  })

  it('loads summaries on open and restores the selected revision', async () => {
    const user = userEvent.setup()
    listDocumentHistory.mockResolvedValue(history)
    const { onRestore } = renderMenu()

    await user.click(screen.getByRole('button', { name: 'Restore version' }))

    expect(await screen.findByRole('button', { name: /Revision 2/ })).toBeInTheDocument()
    expect(listDocumentHistory).toHaveBeenCalledWith(expect.any(String))
    expect(screen.queryByText(/<section/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Revision 1/ }))
    expect(onRestore).toHaveBeenCalledWith(1)
  })

  it('keeps the list open when restore reports a document conflict', async () => {
    const user = userEvent.setup()
    listDocumentHistory.mockResolvedValue(history)
    const onRestore = vi
      .fn()
      .mockRejectedValue(
        new ApiResponseError('The document changed.', { code: 'document_conflict' }),
      )
    renderMenu({ onRestore })

    await user.click(screen.getByRole('button', { name: 'Restore version' }))
    await screen.findByRole('button', { name: /Revision 1/ })
    await user.click(screen.getByRole('button', { name: /Revision 1/ }))

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(1))
    expect(screen.getByRole('button', { name: /Revision 1/ })).toBeInTheDocument()
  })
})
