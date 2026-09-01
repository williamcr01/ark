import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { DocumentHistorySummary } from '@ark/contracts'

import { DocumentHistoryRestoreList } from './DocumentHistoryRestoreList'

const history: DocumentHistorySummary[] = [
  {
    revision: 1,
    source: 'create',
    createdAt: '2026-09-01T00:00:00.000Z',
    byteSize: 120,
  },
  {
    revision: 2,
    source: 'agent',
    createdAt: '2026-09-01T00:05:00.000Z',
    byteSize: 2048,
  },
]

describe('DocumentHistoryRestoreList', () => {
  it('renders summaries newest first without HTML', async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn()
    const html = '<section class="slide">should not render</section>'

    render(
      <DocumentHistoryRestoreList
        history={history.map((row) => ({ ...row, html }) as DocumentHistorySummary)}
        onRestore={onRestore}
      />,
    )

    const items = screen.getAllByRole('button')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Revision 2')
    expect(items[0]).toHaveTextContent('Agent')
    expect(items[0]).toHaveTextContent('2.0 KB')
    expect(items[1]).toHaveTextContent('Revision 1')
    expect(items[1]).toHaveTextContent('Created')
    expect(items[1]).toHaveTextContent('120 B')
    expect(screen.queryByText(/should not render/)).not.toBeInTheDocument()
    expect(screen.queryByText(/<section/)).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Document versions' }).textContent).not.toContain(html)

    await user.click(screen.getByRole('button', { name: /Revision 1/ }))
    expect(onRestore).toHaveBeenCalledWith(1)
  })

  it('shows an empty state when there are no snapshots', () => {
    render(<DocumentHistoryRestoreList history={[]} onRestore={vi.fn()} />)

    expect(screen.getByText('No saved versions yet.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Document versions' })).not.toBeInTheDocument()
  })
})
