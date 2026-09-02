import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { TitleBarDeckActions } from './TitleBarDeckActions'

describe('TitleBarDeckActions', () => {
  it('exports PDF and presents from the title bar', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn()
    const onPresent = vi.fn()
    const onDownload = vi.fn()

    render(
      <TooltipProvider>
        <TitleBarDeckActions
          exportLint={[]}
          exporting={false}
          hasSlides
          isGenerating={false}
          onDownload={onDownload}
          onExport={onExport}
          onPresent={onPresent}
          showSanitizedDownload={false}
        />
      </TooltipProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Export deck' }))
    await user.click(screen.getByText('PDF'))
    await user.click(screen.getByRole('button', { name: 'Present fullscreen' }))

    expect(onExport).toHaveBeenCalledWith('pdf')
    expect(onPresent).toHaveBeenCalledOnce()
  })
})
