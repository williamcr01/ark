import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PresentMode } from './PresentMode'

type PresentHarnessProps = {
  initialSlideIndex?: number
  onExit?: (finalSlideIndex: number) => void
  onGoToSlide?: (index: number) => void
  previewCompromised?: boolean
  slideCount?: number
}

function PresentHarness({
  initialSlideIndex = 0,
  onExit = vi.fn(),
  onGoToSlide,
  previewCompromised = false,
  slideCount = 3,
}: PresentHarnessProps) {
  const [activeSlideIndex, setActiveSlideIndex] = useState(initialSlideIndex)

  return (
    <PresentMode
      activeSlideIndex={activeSlideIndex}
      onExit={onExit}
      onGoToSlide={(index) => {
        setActiveSlideIndex(index)
        onGoToSlide?.(index)
      }}
      previewCompromised={previewCompromised}
      slideCount={slideCount}
    />
  )
}

describe('PresentMode', () => {
  it('renders overlay controls without owning a presentation iframe', () => {
    render(<PresentHarness />)

    expect(screen.getByRole('dialog', { name: 'Presentation mode' })).toHaveAttribute(
      'aria-labelledby',
      'ark-present-mode-title',
    )
    expect(screen.queryByTitle('Ark presentation mode')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit mode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('toolbar', { name: 'Edit mode toolbar' })).not.toBeInTheDocument()
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('delegates slide navigation and exits with the current slide', async () => {
    const user = userEvent.setup()
    const onExit = vi.fn()
    const onGoToSlide = vi.fn()
    render(<PresentHarness onExit={onExit} onGoToSlide={onGoToSlide} />)

    expect(screen.getByText('1 / 3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next slide' }))

    await waitFor(() => {
      expect(screen.getByText('2 / 3')).toBeInTheDocument()
    })
    expect(onGoToSlide).toHaveBeenCalledWith(1)

    await user.click(screen.getByRole('button', { name: 'Exit presentation' }))

    expect(onExit).toHaveBeenCalledWith(1)
  })

  it('exits on Escape with the initial slide when no navigation occurred', async () => {
    const user = userEvent.setup()
    const onExit = vi.fn()
    render(<PresentHarness initialSlideIndex={2} onExit={onExit} />)

    await user.keyboard('{Escape}')

    expect(onExit).toHaveBeenCalledWith(2)
  })

  it('supports keyboard-only navigation between controls', async () => {
    const user = userEvent.setup()
    render(<PresentHarness initialSlideIndex={1} />)

    const dialog = screen.getByRole('dialog', { name: 'Presentation mode' })
    dialog.focus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Previous slide' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Next slide' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Exit presentation' })).toHaveFocus()
  })

  it('shows the shared preview compromise state', () => {
    render(<PresentHarness previewCompromised />)

    expect(screen.getByText('Preview stopped')).toBeVisible()
    expect(screen.getByText(/unexpected navigation/i)).toBeVisible()
  })

  it('portals a viewport-covering backdrop below the shared stage layer', () => {
    render(<PresentHarness />)

    const dialog = screen.getByRole('dialog', { name: 'Presentation mode' })
    expect(dialog.className).toContain('z-[70]')

    const portaledBackdrop = [...document.body.children].find(
      (node) =>
        node instanceof HTMLElement &&
        node.getAttribute('aria-hidden') === 'true' &&
        node.className.includes('z-[40]'),
    )

    expect(portaledBackdrop).toBeInstanceOf(HTMLElement)
    expect(portaledBackdrop?.className).toContain('fixed')
    expect(portaledBackdrop?.className).toContain('inset-0')
  })

  it('keeps keyboard focus inside present controls', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Outside control</button>
        <PresentHarness initialSlideIndex={1} />
      </>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Presentation mode' })
    dialog.focus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Previous slide' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Next slide' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Exit presentation' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Previous slide' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Outside control' })).not.toHaveFocus()
  })
})
