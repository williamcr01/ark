import { render, screen, waitFor } from '@testing-library/react'
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

  it('prefers sandbox-rendered thumbnail images when urls are provided', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const parsedDeck = parseDeckSlides(plainCssDeck)
    render(
      <SlideThumbnailStrip
        activeIndex={0}
        isOpen
        onSelect={onSelect}
        orientation="vertical"
        parsedDeck={parsedDeck}
        thumbnailUrls={[
          '/api/decks/d/thumbnails/v/0.png?hash=abc',
          null,
          '/api/decks/d/thumbnails/v/2.png?hash=abc',
        ]}
      />,
    )

    const images = screen.getAllByTitle(/Slide \d+ thumbnail/)
    expect(images[0]?.tagName).toBe('IMG')
    expect(images[0]).toHaveAttribute('src', '/api/decks/d/thumbnails/v/0.png?hash=abc')
    expect(images[1]?.tagName).toBe('IFRAME')
    expect(images[2]?.tagName).toBe('IMG')

    await user.click(screen.getByRole('button', { name: 'Go to slide 1' }))
    expect(onSelect).toHaveBeenCalledWith(0)
  })

  it('keeps srcDoc iframes while rendered thumbnail urls are still pending', () => {
    const parsedDeck = parseDeckSlides(plainCssDeck)
    render(
      <SlideThumbnailStrip
        activeIndex={0}
        isOpen
        onSelect={vi.fn()}
        orientation="vertical"
        parsedDeck={parsedDeck}
        thumbnailUrls={null}
      />,
    )

    const iframes = screen.getAllByTitle(/Slide \d+ thumbnail/)
    expect(iframes).toHaveLength(3)
    iframes.forEach((iframe) => {
      expect(iframe.tagName).toBe('IFRAME')
      expect(iframe).toHaveAttribute('sandbox', '')
    })
  })

  it('falls back to srcDoc iframes when a rendered image fails to load', async () => {
    const parsedDeck = parseDeckSlides(plainCssDeck)
    render(
      <SlideThumbnailStrip
        activeIndex={0}
        isOpen
        onSelect={vi.fn()}
        orientation="vertical"
        parsedDeck={parsedDeck}
        thumbnailUrls={['/api/decks/d/thumbnails/v/0.png?hash=abc', null, null]}
      />,
    )

    const image = screen.getByTitle('Slide 1 thumbnail')
    expect(image.tagName).toBe('IMG')
    image.dispatchEvent(new Event('error'))

    await waitFor(() => {
      expect(screen.getByTitle('Slide 1 thumbnail').tagName).toBe('IFRAME')
    })
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
