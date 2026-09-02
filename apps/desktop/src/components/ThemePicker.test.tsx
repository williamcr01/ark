// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { exampleThemeProposal } from '@ark/chat/agent-themes.ts'
import { ThemePicker } from '@/components/ThemePicker'

vi.mock('@/components/MiniHtmlPreview', () => ({
  MiniHtmlPreview: ({ title, slideIndex }: { title: string; slideIndex?: number }) => (
    <div data-testid="mini-html-preview">{`${title}:${slideIndex ?? ''}`}</div>
  ),
}))

const request = exampleThemeProposal()

describe('ThemePicker', () => {
  it('compares themes without showing font controls on every card', () => {
    render(<ThemePicker onSubmit={vi.fn()} request={request} />)

    expect(screen.getByText('Georgia · Calibri · Courier New')).toBeInTheDocument()
    expect(screen.getByText('Cambria · Arial · Courier New')).toBeInTheDocument()
    expect(screen.getByText(/Cover split-title/)).toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', { name: 'Display font for Midnight Editorial' }),
    ).not.toBeInTheDocument()
  })

  it('opens a detail panel with fonts, colors, and slide tabs after selection', async () => {
    const user = userEvent.setup()
    render(<ThemePicker onSubmit={vi.fn()} request={request} />)

    await user.click(screen.getByRole('button', { name: 'Select Midnight Editorial' }))

    expect(
      screen.getByRole('combobox', { name: 'Display font for Midnight Editorial' }),
    ).toHaveValue('georgia')
    expect(screen.getByRole('tab', { name: 'Cover' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Content' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Data' })).toBeInTheDocument()
    expect(screen.getByText('Midnight Editorial Cover:0')).toBeInTheDocument()
    expect(screen.getByLabelText('Primary hex for Midnight Editorial')).toHaveValue('#c4a574')

    await user.click(screen.getByRole('tab', { name: 'Content' }))
    expect(screen.getByText('Midnight Editorial Content:1')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Data' }))
    expect(screen.getByText('Midnight Editorial Data:2')).toBeInTheDocument()
  })

  it('submits the resolved theme after font and color overrides', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<ThemePicker onSubmit={onSubmit} request={request} />)

    await user.click(screen.getByRole('button', { name: 'Select Midnight Editorial' }))
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Display font for Midnight Editorial' }),
      'cambria',
    )
    await user.click(screen.getByRole('button', { name: 'Use this theme: Midnight Editorial' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'select',
        themeId: 'midnight',
        fonts: { display: 'cambria', body: 'calibri', mono: 'courier-new' },
        theme: expect.objectContaining({
          fonts: { display: 'cambria', body: 'calibri', mono: 'courier-new' },
          colors: expect.objectContaining({ canvas: '#111111' }),
        }),
      }),
    )
  })

  it('can ask for different suggestions', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<ThemePicker onSubmit={onSubmit} request={request} />)
    await user.click(screen.getByRole('button', { name: 'Suggest different options' }))
    expect(onSubmit).toHaveBeenCalledWith({ action: 'refresh' })
  })
})
