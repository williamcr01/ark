import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { parseDeckSlides, type ParsedDeck } from '@/lib/deck-slides'
import { TooltipProvider } from '@/components/ui/tooltip'
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
    thumbnailSharedKey: 'shared',
    slides: Array.from({ length: slideCount }, (_, index) => ({
      index,
      outerHTML: `<section>Slide ${index + 1}</section>`,
    })),
  }
}

function createDataTransfer() {
  const data = new Map<string, string>()
  return {
    dropEffect: 'none',
    effectAllowed: 'none',
    getData: vi.fn((type: string) => data.get(type) ?? ''),
    setData: vi.fn((type: string, value: string) => data.set(type, value)),
  } as unknown as DataTransfer
}

const THUMBNAIL_HEIGHT = 100
const THUMBNAIL_GAP = 8

/** Stacks thumbnail rects vertically so pointer-geometry hit detection works in jsdom. */
function mockThumbnailBounds(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('[draggable]').forEach((thumbnail, index) => {
    const top = index * (THUMBNAIL_HEIGHT + THUMBNAIL_GAP)
    vi.spyOn(thumbnail, 'getBoundingClientRect').mockReturnValue({
      bottom: top + THUMBNAIL_HEIGHT,
      height: THUMBNAIL_HEIGHT,
      left: 0,
      right: 152,
      toJSON: () => ({}),
      top,
      width: 152,
      x: 0,
      y: top,
    } as DOMRect)
  })
}

function fireDragAt(
  element: Element,
  type: 'dragOver' | 'drop',
  dataTransfer: DataTransfer,
  clientY: number,
) {
  const event = createEvent[type](element, { dataTransfer })
  Object.defineProperty(event, 'clientY', { value: clientY })
  fireEvent(element, event)
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
    expect(
      screen.getByRole('button', { name: 'Go to slide 2' }).closest('[draggable]'),
    ).toHaveAttribute('draggable', 'false')

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

  it('reveals a rendered thumbnail only after it decodes', async () => {
    const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode')
    const decode = vi.fn(() => Promise.resolve())
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value: decode,
    })

    try {
      render(
        <SlideThumbnailStrip
          activeIndex={0}
          isOpen
          onSelect={vi.fn()}
          orientation="vertical"
          parsedDeck={createParsedDeck(1)}
          thumbnailUrls={['/api/decks/d/thumbnails/v/0.png?hash=abc']}
        />,
      )

      const image = screen.getByTitle('Slide 1 thumbnail')
      expect(image).toHaveClass('opacity-0')

      fireEvent.load(image)

      await waitFor(() => {
        expect(image).toHaveClass('opacity-100')
      })
      expect(decode).toHaveBeenCalledOnce()
    } finally {
      if (originalDecode) {
        Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode)
      } else {
        Reflect.deleteProperty(HTMLImageElement.prototype, 'decode')
      }
    }
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

  it('loads mounted thumbnails concurrently while prioritizing the first and active slides', () => {
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

    expect(screen.getByTitle('Slide 6 thumbnail')).toHaveAttribute('loading', 'eager')
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

  it('reuses an unchanged fallback document when another slide is edited', async () => {
    const firstBuilder = vi.fn(
      (index: number) => `<!doctype html><html><body>First ${index}</body></html>`,
    )
    const firstDeck = createParsedDeck(2, firstBuilder)
    const { rerender } = render(
      <SlideThumbnailStrip
        activeIndex={0}
        isOpen
        onSelect={vi.fn()}
        orientation="vertical"
        parsedDeck={firstDeck}
      />,
    )

    await waitFor(() => {
      expect(firstBuilder).toHaveBeenCalledTimes(2)
    })

    const unchangedSrcDoc = screen.getByTitle('Slide 1 thumbnail').getAttribute('srcdoc')
    const secondBuilder = vi.fn(
      (index: number) => `<!doctype html><html><body>Second ${index}</body></html>`,
    )
    const secondDeck = createParsedDeck(2, secondBuilder)
    secondDeck.slides[1] = {
      index: 1,
      outerHTML: '<section>Edited slide 2</section>',
    }

    rerender(
      <SlideThumbnailStrip
        activeIndex={0}
        isOpen
        onSelect={vi.fn()}
        orientation="vertical"
        parsedDeck={secondDeck}
      />,
    )

    expect(screen.getByTitle('Slide 1 thumbnail')).toHaveAttribute('srcdoc', unchangedSrcDoc)
    expect(secondBuilder).not.toHaveBeenCalledWith(0)
    await waitFor(() => {
      expect(secondBuilder).toHaveBeenCalledWith(1)
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

  it('reorders a slide when its thumbnail is dropped on another thumbnail', async () => {
    let finishReorder: () => void = () => undefined
    const onReorder = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishReorder = resolve
        }),
    )
    const dataTransfer = createDataTransfer()
    const { container } = render(
      <SlideThumbnailStrip
        activeIndex={0}
        isOpen
        onReorder={onReorder}
        onSelect={vi.fn()}
        orientation="vertical"
        parsedDeck={createParsedDeck(3)}
      />,
    )
    mockThumbnailBounds(container)

    const source = screen.getByRole('button', { name: 'Go to slide 1' }).closest('[draggable]')!
    const target = screen.getByRole('button', { name: 'Go to slide 3' }).closest('[draggable]')!

    fireEvent.dragStart(source, { dataTransfer })
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', '0')
    // Below the midpoint of slide 3 (top 216, midpoint 266) → insert after it.
    fireDragAt(target, 'dragOver', dataTransfer, 300)
    expect(source).toHaveStyle({ transform: 'translateY(calc(200% + 1rem))' })
    expect(target).toHaveStyle({ transform: 'translateY(calc(-100% - 0.5rem))' })
    fireDragAt(target, 'drop', dataTransfer, 300)

    await waitFor(() => expect(onReorder).toHaveBeenCalledWith(0, 2))
    expect(source).toHaveStyle({ transform: 'translateY(calc(200% + 1rem))' })

    finishReorder()
    await waitFor(() =>
      expect(source).not.toHaveStyle({ transform: 'translateY(calc(200% + 1rem))' }),
    )
    expect(onReorder).toHaveBeenCalledTimes(1)
  })

  it('drops the preview transforms as soon as the reordered deck renders', async () => {
    let finishReorder: () => void = () => undefined
    const onReorder = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishReorder = resolve
        }),
    )
    const dataTransfer = createDataTransfer()
    const props = {
      activeIndex: 0,
      isOpen: true,
      onReorder,
      onSelect: vi.fn(),
      orientation: 'vertical',
    } as const
    const { container, rerender } = render(
      <SlideThumbnailStrip {...props} parsedDeck={createParsedDeck(3)} />,
    )
    mockThumbnailBounds(container)

    const source = screen.getByRole('button', { name: 'Go to slide 1' }).closest('[draggable]')!
    fireEvent.dragStart(source, { dataTransfer })
    fireDragAt(source, 'dragOver', dataTransfer, 300)
    fireDragAt(source, 'drop', dataTransfer, 300)

    await waitFor(() => expect(onReorder).toHaveBeenCalledWith(0, 2))
    expect(source).toHaveStyle({ transform: 'translateY(calc(200% + 1rem))' })

    // The reordered deck HTML arrives before the reorder promise resolves;
    // index-based transforms must not be applied on top of the new order.
    rerender(<SlideThumbnailStrip {...props} parsedDeck={createParsedDeck(3)} />)
    expect(source).not.toHaveStyle({ transform: 'translateY(calc(200% + 1rem))' })

    finishReorder()
    await waitFor(() => expect(onReorder).toHaveBeenCalledTimes(1))
  })

  it('previews and drops at the exact side of a thumbnail', async () => {
    const onReorder = vi.fn().mockResolvedValue(undefined)
    const dataTransfer = createDataTransfer()
    const { container } = render(
      <SlideThumbnailStrip
        activeIndex={2}
        isOpen
        onReorder={onReorder}
        onSelect={vi.fn()}
        orientation="vertical"
        parsedDeck={createParsedDeck(3)}
      />,
    )
    mockThumbnailBounds(container)

    const source = screen.getByRole('button', { name: 'Go to slide 3' }).closest('[draggable]')!
    const target = screen.getByRole('button', { name: 'Go to slide 1' }).closest('[draggable]')!

    fireEvent.dragStart(source, { dataTransfer })

    // Bottom half of slide 1 (midpoint 50) → insert after it; slide 1 stays put.
    fireDragAt(target, 'dragOver', dataTransfer, 60)
    expect(source).toHaveStyle({ transform: 'translateY(calc(-100% - 0.5rem))' })
    expect(target).not.toHaveStyle({ transform: 'translateY(calc(100% + 0.5rem))' })

    // Top half of slide 1 → insert before it; slide 1 shifts down.
    fireDragAt(target, 'dragOver', dataTransfer, 20)
    expect(source).toHaveStyle({ transform: 'translateY(calc(-200% - 1rem))' })
    expect(target).toHaveStyle({ transform: 'translateY(calc(100% + 0.5rem))' })

    fireDragAt(target, 'drop', dataTransfer, 20)
    await waitFor(() => expect(onReorder).toHaveBeenCalledWith(2, 0))
  })

  it('accepts drops in the thumbnail strip gaps', async () => {
    const onReorder = vi.fn().mockResolvedValue(undefined)
    const dataTransfer = createDataTransfer()
    const { container } = render(
      <SlideThumbnailStrip
        activeIndex={0}
        isOpen
        onReorder={onReorder}
        onSelect={vi.fn()}
        orientation="vertical"
        parsedDeck={createParsedDeck(3)}
      />,
    )
    mockThumbnailBounds(container)

    const source = screen.getByRole('button', { name: 'Go to slide 1' }).closest('[draggable]')!
    const dropZone = container.querySelector<HTMLElement>('[data-slot="slide-reorder-zone"]')!

    fireEvent.dragStart(source, { dataTransfer })
    fireDragAt(dropZone, 'dragOver', dataTransfer, 1_000)

    expect(source).toHaveStyle({ transform: 'translateY(calc(200% + 1rem))' })

    fireDragAt(dropZone, 'drop', dataTransfer, 1_000)
    await waitFor(() => expect(onReorder).toHaveBeenCalledWith(0, 2))
  })

  it('does not send a same-index reorder', () => {
    const onReorder = vi.fn()
    const dataTransfer = createDataTransfer()
    const { container } = render(
      <SlideThumbnailStrip
        activeIndex={0}
        isOpen
        onReorder={onReorder}
        onSelect={vi.fn()}
        orientation="vertical"
        parsedDeck={createParsedDeck(2)}
      />,
    )
    mockThumbnailBounds(container)

    const thumbnail = screen.getByRole('button', { name: 'Go to slide 1' }).closest('[draggable]')!
    fireEvent.dragStart(thumbnail, { dataTransfer })
    // Bottom half of the dragged slide → insertion collapses back to its own index.
    fireDragAt(thumbnail, 'drop', dataTransfer, 60)

    expect(onReorder).not.toHaveBeenCalled()
  })

  it('reorders repeatedly by keyboard, keeps focus, and traps matching edge shortcuts', async () => {
    const onReorder = vi.fn().mockResolvedValue(undefined)
    render(
      <SlideThumbnailStrip
        activeIndex={0}
        isOpen
        onReorder={onReorder}
        onSelect={vi.fn()}
        orientation="vertical"
        parsedDeck={createParsedDeck(3)}
      />,
    )

    const first = screen.getByRole('button', { name: 'Go to slide 1' })
    expect(first).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown')
    first.focus()
    expect(fireEvent.keyDown(first, { altKey: true, key: 'ArrowDown' })).toBe(false)

    const second = screen.getByRole('button', { name: 'Go to slide 2' })
    await waitFor(() => expect(second).toHaveFocus())
    expect(onReorder).toHaveBeenLastCalledWith(0, 1)
    expect(fireEvent.keyDown(second, { altKey: true, key: 'ArrowDown' })).toBe(false)

    const third = screen.getByRole('button', { name: 'Go to slide 3' })
    await waitFor(() => expect(third).toHaveFocus())
    expect(onReorder).toHaveBeenLastCalledWith(1, 2)
    expect(fireEvent.keyDown(third, { altKey: true, key: 'ArrowDown' })).toBe(false)
    expect(onReorder).toHaveBeenCalledTimes(2)
  })

  it('toggles slide chat context without changing the active slide', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onToggleContextSlide = vi.fn()
    const parsedDeck = createParsedDeck(2)

    render(
      <TooltipProvider>
        <SlideThumbnailStrip
          activeIndex={0}
          contextSlideIndexes={[1]}
          isOpen
          onSelect={onSelect}
          onToggleContextSlide={onToggleContextSlide}
          orientation="vertical"
          parsedDeck={parsedDeck}
        />
      </TooltipProvider>,
    )

    const addButton = screen.getByRole('button', { name: 'Add slide 1 to chat' })
    const removeButton = screen.getByRole('button', { name: 'Remove slide 2 from chat' })

    expect(removeButton).toHaveAttribute('aria-pressed', 'true')
    expect(addButton).toHaveAttribute('aria-pressed', 'false')

    await user.click(addButton)
    expect(onToggleContextSlide).toHaveBeenCalledWith(0)
    expect(onSelect).not.toHaveBeenCalled()

    await user.click(removeButton)
    expect(onToggleContextSlide).toHaveBeenCalledWith(1)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
