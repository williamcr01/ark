import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ChatSendQueue } from '@/components/ChatSendQueue'
import { TooltipProvider } from '@/components/ui/tooltip'

const items = [
  { id: 'a', text: 'make the title darker', attachmentCount: 0 },
  { id: 'b', text: 'add a timeline', attachmentCount: 1 },
]

describe('ChatSendQueue', () => {
  it('renders one chip per queued message with Send all', () => {
    render(
      <TooltipProvider>
        <ChatSendQueue
          items={items}
          onDismiss={vi.fn()}
          onEdit={vi.fn()}
          onSendAll={vi.fn()}
          onSendNow={vi.fn()}
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('2 queued messages')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Queued messages' })).toBeInTheDocument()
    expect(screen.getByText('make the title darker')).toBeInTheDocument()
    expect(screen.getByText('add a timeline')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send all' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Send now' })).toHaveLength(2)
  })

  it('dismisses, sends one, sends all, and edits in place', async () => {
    const onDismiss = vi.fn()
    const onEdit = vi.fn()
    const onSendAll = vi.fn()
    const onSendNow = vi.fn()
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <ChatSendQueue
          items={items}
          onDismiss={onDismiss}
          onEdit={onEdit}
          onSendAll={onSendAll}
          onSendNow={onSendNow}
        />
      </TooltipProvider>,
    )

    await user.click(screen.getAllByRole('button', { name: 'Send now' })[1]!)
    expect(onSendNow).toHaveBeenCalledWith('b')

    await user.click(screen.getByRole('button', { name: 'Send all' }))
    expect(onSendAll).toHaveBeenCalledTimes(1)

    await user.click(screen.getAllByRole('button', { name: 'Dismiss queued message' })[0]!)
    expect(onDismiss).toHaveBeenCalledWith('a')

    await user.click(screen.getByRole('button', { name: 'make the title darker' }))
    const editor = screen.getByRole('textbox', { name: 'Edit queued message' })
    await user.clear(editor)
    await user.type(editor, 'make the subtitle darker')
    await user.keyboard('{Enter}')
    expect(onEdit).toHaveBeenCalledWith('a', 'make the subtitle darker')
  })
})
