import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { TitleBarFileMenu } from './TitleBarFileMenu'

describe('TitleBarFileMenu', () => {
  it('opens the home overflow menu', async () => {
    const user = userEvent.setup()
    const onOpenWorkspace = vi.fn()
    const onUploadClick = vi.fn()

    render(
      <TooltipProvider>
        <TitleBarFileMenu
          activeDeckId={null}
          isGenerating={false}
          onDuplicate={vi.fn()}
          onMove={vi.fn()}
          onOpenWorkspace={onOpenWorkspace}
          onPptxImportClick={vi.fn()}
          onReveal={vi.fn()}
          onSaveAs={vi.fn()}
          onShareProject={vi.fn()}
          onUploadClick={onUploadClick}
          variant="home"
        />
      </TooltipProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'File actions' }))
    await user.click(screen.getByText('Open Ark workspace'))
    expect(onOpenWorkspace).toHaveBeenCalledOnce()
  })

  it('shows editor file actions as icon buttons', () => {
    render(
      <TooltipProvider>
        <TitleBarFileMenu
          activeDeckId="deck-1"
          isGenerating={false}
          onDuplicate={vi.fn()}
          onMove={vi.fn()}
          onOpenWorkspace={vi.fn()}
          onPptxImportClick={vi.fn()}
          onReveal={vi.fn()}
          onSaveAs={vi.fn()}
          onShareProject={vi.fn()}
          onUploadClick={vi.fn()}
          variant="editor"
        />
      </TooltipProvider>,
    )

    expect(screen.getByRole('button', { name: 'Save As' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Share Ark Project' })).toBeEnabled()
  })
})
