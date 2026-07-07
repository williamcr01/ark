import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { parseDeckSlides } from '@/lib/deck-slides'
import plainCssDeck from '@fixtures/plain-css-deck.html?raw'

import { SlideThumbnailStrip } from './SlideThumbnailStrip'

describe('SlideThumbnailStrip', () => {
  it('renders static sandboxed thumbnail iframes from parsed thumbnail srcdocs', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const parsedDeck = parseDeckSlides(plainCssDeck)
    render(
      <SlideThumbnailStrip
        activeIndex={1}
        isOpen
        onSelect={onSelect}
        orientation="vertical"
        parsedDeck={parsedDeck}
      />,
    )

    expect(screen.getByText('Slides')).toBeInTheDocument()
    expect(screen.getByText('Slides').parentElement).toHaveTextContent('3')

    const iframes = screen.getAllByTitle(/Slide \d+ thumbnail/)

    expect(iframes).toHaveLength(3)
    iframes.forEach((iframe, index) => {
      expect(iframe).toHaveAttribute('sandbox', '')
      expect(iframe).toHaveAttribute('srcdoc', parsedDeck.thumbnailSrcDocs[index])
      expect(iframe).not.toHaveAttribute('allow')
    })

    expect(screen.getByRole('button', { name: 'Go to slide 2' })).toHaveAttribute(
      'aria-current',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Go to slide 3' }))

    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('hides the thumbnail strip without unmounting the persisted selection shell', () => {
    const parsedDeck = parseDeckSlides(plainCssDeck)
    const { container } = render(
      <SlideThumbnailStrip
        activeIndex={0}
        isOpen={false}
        onSelect={vi.fn()}
        orientation="horizontal"
        parsedDeck={parsedDeck}
      />,
    )
    const strip = container.querySelector('aside')

    expect(strip).toHaveAttribute('aria-hidden', 'true')
    expect(strip).toHaveClass('hidden')
  })
})
