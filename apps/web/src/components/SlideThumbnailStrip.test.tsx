import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { parseDeckSlides, type ParsedDeck } from '@/lib/deck-slides'
import plainCssDeck from '@fixtures/plain-css-deck.html?raw'

import { SlideThumbnailStrip } from './SlideThumbnailStrip'

function createParsedDeck(
  slideCount: number,
  getThumbnailSrcDoc: ParsedDeck['getThumbnailSrcDoc'] = (index) =>
    `<!DOCTYPE html><html><body><section>Slide ${index + 1}</section></body></html>`,
): ParsedDeck {
  return {
    bodyAttrs: '',
    getThumbnailSrcDoc,
    headHtml: '',
    htmlAttrs: '',
    slideCount,
    slides: Array.from({ length: slideCount }, (_, index) => ({
      index,
      outerHTML: `<section>Slide ${index + 1}</section>`,
    })),
  }
}

describe('SlideThumbnailStrip', () => {
  it('renders sandboxed fallback iframes from parsed thumbnail builders', async () => {
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

    expect(screen.getByTitle('Slide 2 thumbnail').getAttribute('srcdoc')).toContain(
      'Metrics that moved',
    )

    await waitFor(() => {
      expect(screen.getAllByTitle(/Slide \d+ thumbnail/)).toHaveLength(3)
    })

    const iframes = screen.getAllByTitle(/Slide \d+ thumbnail/)

    expect(iframes).toHaveLength(3)
    iframes.forEach((iframe, index) => {
      expect(iframe).toHaveAttribute('sandbox', '')
      expect(iframe.getAttribute('srcdoc')).toContain(
        ['Quarterly planning', 'Metrics that moved', 'Next decisions'][index] ?? '',
      )
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

    await waitFor(() => {
      expect(screen.getAllByTitle(/Slide \d+ thumbnail/)).toHaveLength(3)
    })

    expect(screen.getByTitle('Slide 1 thumbnail').tagName).toBe('IMG')
    expect(screen.getByTitle('Slide 1 thumbnail')).toHaveAttribute(
      'src',
      '/api/decks/d/thumbnails/v/0.png?hash=abc',
    )
    expect(screen.getByTitle('Slide 2 thumbnail').tagName).toBe('IFRAME')
    expect(screen.getByTitle('Slide 3 thumbnail').tagName).toBe('IMG')

    await user.click(screen.getByRole('button', { name: 'Go to slide 1' }))
    expect(onSelect).toHaveBeenCalledWith(0)
  })

  it('keeps srcDoc iframes while rendered thumbnail urls are still pending', async () => {
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

    await waitFor(() => {
      expect(screen.getAllByTitle(/Slide \d+ thumbnail/)).toHaveLength(3)
    })

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

  it('does not build fallback documents while closed', () => {
    const getThumbnailSrcDoc = vi.fn((index: number) => `slide-${index}`)
    const parsedDeck = createParsedDeck(3, getThumbnailSrcDoc)

    render(
      <SlideThumbnailStrip
        activeIndex={1}
        isOpen={false}
        onSelect={vi.fn()}
        orientation="vertical"
        parsedDeck={parsedDeck}
      />,
    )

    expect(getThumbnailSrcDoc).not.toHaveBeenCalled()
  })

  it('keeps thumbnail content off the main preview critical path', () => {
    const getThumbnailSrcDoc = vi.fn((index: number) => `slide-${index}`)
    const parsedDeck = createParsedDeck(3, getThumbnailSrcDoc)
    const { rerender } = render(
      <SlideThumbnailStrip
        activeIndex={0}
        contentEnabled={false}
        isOpen
        onSelect={vi.fn()}
        orientation="vertical"
        parsedDeck={parsedDeck}
        thumbnailUrls={[
          '/api/decks/d/thumbnails/v/0.png?hash=abc',
          '/api/decks/d/thumbnails/v/1.png?hash=abc',
          '/api/decks/d/thumbnails/v/2.png?hash=abc',
        ]}
      />,
    )

    expect(getThumbnailSrcDoc).not.toHaveBeenCalled()
    expect(screen.queryByTitle(/thumbnail/)).not.toBeInTheDocument()

    rerender(
      <SlideThumbnailStrip
        activeIndex={0}
        contentEnabled
        isOpen
        onSelect={vi.fn()}
        orientation="vertical"
        parsedDeck={parsedDeck}
        thumbnailUrls={[
          '/api/decks/d/thumbnails/v/0.png?hash=abc',
          '/api/decks/d/thumbnails/v/1.png?hash=abc',
          '/api/decks/d/thumbnails/v/2.png?hash=abc',
        ]}
      />,
    )

    expect(screen.getByTitle('Slide 1 thumbnail')).toHaveAttribute('src')
    expect(getThumbnailSrcDoc).not.toHaveBeenCalled()
  })

  it('eagerly prioritizes the first thumbnails and active slide', () => {
    const parsedDeck = createParsedDeck(7)
    const thumbnailUrls = Array.from(
      { length: 7 },
      (_, index) => `/api/decks/d/thumbnails/v/${index}.png?hash=abc`,
    )

    render(
      <SlideThumbnailStrip
        activeIndex={6}
        isOpen
        onSelect={vi.fn()}
        orientation="vertical"
        parsedDeck={parsedDeck}
        thumbnailUrls={thumbnailUrls}
      />,
    )

    for (let index = 0; index < 5; index += 1) {
      expect(screen.getByTitle(`Slide ${index + 1} thumbnail`)).toHaveAttribute('loading', 'eager')
      expect(screen.getByTitle(`Slide ${index + 1} thumbnail`)).toHaveAttribute(
        'fetchpriority',
        'high',
      )
    }

    expect(screen.getByTitle('Slide 6 thumbnail')).toHaveAttribute('loading', 'lazy')
    expect(screen.getByTitle('Slide 7 thumbnail')).toHaveAttribute('loading', 'eager')
  })

  it('does not build fallback documents when PNG thumbnails are available', () => {
    const getThumbnailSrcDoc = vi.fn((index: number) => `slide-${index}`)
    const parsedDeck = createParsedDeck(3, getThumbnailSrcDoc)

    render(
      <SlideThumbnailStrip
        activeIndex={1}
        isOpen
        onSelect={vi.fn()}
        orientation="vertical"
        parsedDeck={parsedDeck}
        thumbnailUrls={[
          '/api/decks/d/thumbnails/v/0.png?hash=abc',
          '/api/decks/d/thumbnails/v/1.png?hash=abc',
          '/api/decks/d/thumbnails/v/2.png?hash=abc',
        ]}
      />,
    )

    expect(getThumbnailSrcDoc).not.toHaveBeenCalled()
  })

  it('builds the active fallback synchronously before yielding for mounted slides', async () => {
    const getThumbnailSrcDoc = vi.fn(
      (index: number) => `<!DOCTYPE html><html><body>Slide ${index + 1}</body></html>`,
    )
    const parsedDeck = createParsedDeck(3, getThumbnailSrcDoc)

    render(
      <SlideThumbnailStrip
        activeIndex={1}
        isOpen
        onSelect={vi.fn()}
        orientation="vertical"
        parsedDeck={parsedDeck}
      />,
    )

    expect(getThumbnailSrcDoc).toHaveBeenCalledTimes(1)
    expect(getThumbnailSrcDoc).toHaveBeenNthCalledWith(1, 1)

    await waitFor(() => {
      expect(getThumbnailSrcDoc).toHaveBeenCalledTimes(3)
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
