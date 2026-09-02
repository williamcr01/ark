// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ThemePicker } from '@/components/ThemePicker'
import type { ThemeProposalRequest } from '@ark/chat/agent-themes.ts'

vi.mock('@/components/MiniHtmlPreview', () => ({
  MiniHtmlPreview: ({ title }: { title: string }) => (
    <div data-testid="mini-html-preview">{title}</div>
  ),
}))

const sampleHtml = '<!doctype html><html><body><section class="slide"></section></body></html>'

const request: ThemeProposalRequest = {
  title: 'Pick a visual direction',
  themes: [
    {
      id: 'midnight',
      name: 'Midnight Editorial',
      description: 'Dark and sharp',
      fonts: { display: 'georgia', body: 'calibri', mono: 'courier-new' },
      sampleHtml,
    },
    {
      id: 'sunlit',
      name: 'Sunlit Studio',
      description: 'Warm and airy',
      fonts: { display: 'cambria', body: 'arial', mono: 'courier-new' },
      sampleHtml,
    },
    {
      id: 'signal',
      name: 'Signal Grid',
      description: 'Bold sans',
      fonts: { display: 'arial', body: 'calibri', mono: 'courier-new' },
      sampleHtml,
    },
    {
      id: 'folio',
      name: 'Quiet Folio',
      description: 'Soft paper',
      fonts: { display: 'times-new-roman', body: 'georgia', mono: 'courier-new' },
      sampleHtml,
    },
  ],
}

describe('ThemePicker font roles', () => {
  it('shows each theme pairing from the fonts contract', () => {
    render(<ThemePicker onSubmit={vi.fn()} request={request} />)

    expect(screen.getByText('Georgia · Calibri · Courier New')).toBeInTheDocument()
    expect(screen.getByText('Cambria · Arial · Courier New')).toBeInTheDocument()
    expect(screen.getByText('Arial · Calibri · Courier New')).toBeInTheDocument()
    expect(screen.getByText('Times New Roman · Georgia · Courier New')).toBeInTheDocument()

    const display = screen.getByRole('combobox', { name: 'Display font for Midnight Editorial' })
    expect(display).toHaveValue('georgia')
    expect(screen.getByRole('combobox', { name: 'Body font for Midnight Editorial' })).toHaveValue(
      'calibri',
    )
    expect(screen.getByRole('combobox', { name: 'Mono font for Midnight Editorial' })).toHaveValue(
      'courier-new',
    )
    expect(screen.getAllByRole('option', { name: 'Georgia' })).toHaveLength(12)
    expect(screen.getAllByRole('option', { name: 'Courier New' })).toHaveLength(12)
  })

  it('lets the user edit display, body, and mono then submits the pairing', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<ThemePicker onSubmit={onSubmit} request={request} />)

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Display font for Midnight Editorial' }),
      'cambria',
    )
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Body font for Midnight Editorial' }),
      'arial',
    )

    expect(screen.queryByText('Georgia · Calibri · Courier New')).not.toBeInTheDocument()
    expect(screen.getAllByText('Cambria · Arial · Courier New')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Use this theme: Midnight Editorial' }))

    expect(onSubmit).toHaveBeenCalledWith('midnight', {
      display: 'cambria',
      body: 'arial',
      mono: 'courier-new',
    })
  })
})
