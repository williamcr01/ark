import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import plainCssDeck from '@/test/fixtures/plain-css-deck.html?raw'

import { PresentMode } from './PresentMode'

describe('PresentMode', () => {
  it('renders the deck in an allow-scripts sandbox and exits with the current slide', async () => {
    const user = userEvent.setup()
    const onExit = vi.fn()
    render(
      <PresentMode
        html={plainCssDeck}
        initialSlideIndex={0}
        onExit={onExit}
        previewMode="css-only"
        slideCount={3}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Presentation mode' }))
      .toBeInTheDocument()
    expect(screen.getByTitle('Ark presentation mode'))
      .toHaveAttribute('sandbox', 'allow-scripts')
    expect(screen.getByText('1 / 3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next slide' }))

    await waitFor(() => {
      expect(screen.getByText('2 / 3')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Exit' }))

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
        previewMode="css-only"
        slideCount={3}
      />,
    )

    await user.keyboard('{Escape}')

    expect(onExit).toHaveBeenCalledWith(2)
  })
})
