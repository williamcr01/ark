import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import hostileScriptsDeck from '@/test/fixtures/hostile-scripts-deck.html?raw'
import plainCssDeck from '@/test/fixtures/plain-css-deck.html?raw'
import { parseDeckSlides } from '@/lib/deck-slides'

import { DeckPreview } from './DeckPreview'

vi.mock('@/hooks/useDeckSlideNavigation', () => ({
  useDeckSlideNavigation: () => ({
    activeSlideIndex: 0,
    goToSlide: vi.fn(),
  }),
}))

vi.mock('@/hooks/useElementSize', () => ({
  useElementSize: () => [vi.fn(), { width: 1600, height: 900 }],
}))

describe('DeckPreview script divergence UI', () => {
  it('shows static preview messaging for uploaded scripted decks', () => {
    render(
      <DeckPreview
        html={hostileScriptsDeck}
        isGenerating={false}
        isStripOpen={false}
        layout="desktop"
        parsedDeck={parseDeckSlides(hostileScriptsDeck)}
      />,
    )

    expect(screen.getAllByText('Static preview').length).toBeGreaterThan(0)
    expect(screen.getByText(/Scripts and inline handlers were removed for preview/i)).toBeVisible()
  })

  it('does not show static preview messaging for plain CSS decks', () => {
    render(
      <DeckPreview
        html={plainCssDeck}
        isGenerating={false}
        isStripOpen={false}
        layout="desktop"
        parsedDeck={parseDeckSlides(plainCssDeck)}
      />,
    )

    expect(screen.queryByText('Static preview')).not.toBeInTheDocument()
  })
})
