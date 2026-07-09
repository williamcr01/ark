import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import plainCssDeck from '@fixtures/plain-css-deck.html?raw'
import revealRegistryDeck from '@fixtures/reveal-registry-deck.html?raw'

import { PresentMode } from './PresentMode'

const reportRuntimeErrorMock = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'err-1' }))

vi.mock('@/lib/runtime-error-api', () => ({
  reportRuntimeError: reportRuntimeErrorMock,
}))

describe('PresentMode', () => {
  beforeEach(() => {
    reportRuntimeErrorMock.mockClear()
  })

  it('does not expose edit controls in presentation mode', () => {
    render(
      <PresentMode
        html={plainCssDeck}
        initialSlideIndex={0}
        onExit={vi.fn()}
        runtimeMode="static"
        slideCount={3}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Edit mode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('toolbar', { name: 'Edit mode toolbar' })).not.toBeInTheDocument()
  })

  it('does not expose edit controls in reveal presentation mode', () => {
    render(
      <PresentMode
        html={revealRegistryDeck}
        initialSlideIndex={0}
        onExit={vi.fn()}
        runtimeMode="reveal"
        slideCount={2}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Edit mode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('toolbar', { name: 'Edit mode toolbar' })).not.toBeInTheDocument()
  })

  it('renders the deck in an allow-scripts sandbox and exits with the current slide', async () => {
    const user = userEvent.setup()
    const onExit = vi.fn()
    render(
      <PresentMode
        html={plainCssDeck}
        initialSlideIndex={0}
        onExit={onExit}
        runtimeMode="static"
        slideCount={3}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Presentation mode' })).toHaveAttribute(
      'aria-labelledby',
      'ark-present-mode-title',
    )
    expect(screen.getByTitle('Ark presentation mode')).toHaveAttribute('sandbox', 'allow-scripts')
    expect(screen.getByText('1 / 3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next slide' }))

    await waitFor(() => {
      expect(screen.getByText('2 / 3')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Exit presentation' }))

    expect(onExit).toHaveBeenCalledWith(1)
  })

  it('exits on Escape with the initial slide when no navigation occurred', async () => {
    const user = userEvent.setup()
    const onExit = vi.fn()
    render(
      <PresentMode
        html={plainCssDeck}
        initialSlideIndex={2}
        onExit={onExit}
        runtimeMode="static"
        slideCount={3}
      />,
    )

    await user.keyboard('{Escape}')

    expect(onExit).toHaveBeenCalledWith(2)
  })

  it('supports keyboard-only navigation between controls', async () => {
    const user = userEvent.setup()
    render(
      <PresentMode
        html={plainCssDeck}
        initialSlideIndex={1}
        onExit={vi.fn()}
        runtimeMode="static"
        slideCount={3}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Presentation mode' })
    dialog.focus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Previous slide' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Next slide' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Exit presentation' })).toHaveFocus()
  })

  it('preserves the current slide when exiting reveal present mode', async () => {
    const user = userEvent.setup()
    const onExit = vi.fn()
    render(
      <PresentMode
        html={revealRegistryDeck}
        initialSlideIndex={0}
        onExit={onExit}
        runtimeMode="reveal"
        slideCount={2}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Next slide' }))

    await waitFor(() => {
      expect(screen.getByText('2 / 2')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Exit presentation' }))

    expect(onExit).toHaveBeenCalledWith(1)
  })

  it('tears down the presentation iframe on unexpected self-navigation', async () => {
    render(
      <PresentMode
        html={plainCssDeck}
        initialSlideIndex={0}
        onExit={vi.fn()}
        runtimeMode="static"
        slideCount={3}
      />,
    )

    const iframe = screen.getByTitle('Ark presentation mode')

    fireEvent.load(iframe)
    expect(screen.queryByText('Preview stopped')).not.toBeInTheDocument()

    fireEvent.load(iframe)

    expect(await screen.findByText('Preview stopped')).toBeVisible()
    expect(screen.queryByTitle('Ark presentation mode')).not.toBeInTheDocument()
    expect(reportRuntimeErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'preview-navigation-guard',
        severity: 'error',
      }),
    )
  })
})
