import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  DECK_GOTO_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
  type DeckRuntimeMode,
} from '@/lib/deck-preview'
import plainCssDeck from '@/test/fixtures/plain-css-deck.html?raw'

import {
  useDeckSlideNavigation,
  type DeckNavOptions,
} from './useDeckSlideNavigation'

type HarnessProps = {
  enabled?: boolean
  html?: string
  initialSlideIndex?: number
  keyboardMode?: DeckNavOptions['keyboardMode']
  onSlideChange?: (index: number) => void
  runtimeMode?: DeckRuntimeMode
  slideCount?: number
  syncOnLoad?: boolean
}

function NavigationHarness({
  enabled = true,
  html = plainCssDeck,
  initialSlideIndex = 0,
  keyboardMode = 'preview',
  onSlideChange,
  runtimeMode = 'static',
  slideCount = 3,
  syncOnLoad = false,
}: HarnessProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { activeSlideIndex, goToSlide } = useDeckSlideNavigation(
    iframeRef,
    slideCount,
    html,
    enabled,
    {
      initialSlideIndex,
      keyboardMode,
      onSlideChange,
      runtimeMode,
      syncOnLoad,
    },
  )

  return (
    <div>
      <iframe ref={iframeRef} title="Deck preview" />
      <output aria-label="Active slide">{activeSlideIndex}</output>
      <button onClick={() => goToSlide(2)} type="button">
        Go to third
      </button>
      <input aria-label="Slide title" />
    </div>
  )
}

function getIframeWindow() {
  const iframe = screen.getByTitle('Deck preview') as HTMLIFrameElement
  const iframeWindow = iframe.contentWindow

  if (!iframeWindow) {
    throw new Error('Expected iframe window to exist')
  }

  return iframeWindow
}

describe('useDeckSlideNavigation', () => {
  it('posts goto messages and commits the active slide when goToSlide is called', async () => {
    const user = userEvent.setup()
    render(<NavigationHarness />)
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')

    await user.click(screen.getByRole('button', { name: 'Go to third' }))

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('2')
    expect(postMessage).toHaveBeenCalledWith(
      { type: DECK_GOTO_MESSAGE_TYPE, index: 2 },
      '*',
    )
  })

  it('ignores out-of-range goto requests', async () => {
    const user = userEvent.setup()
    render(<NavigationHarness slideCount={2} />)
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')

    await user.click(screen.getByRole('button', { name: 'Go to third' }))

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('0')
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('accepts slide-change acknowledgements only from the preview iframe', async () => {
    const onSlideChange = vi.fn()
    render(<NavigationHarness onSlideChange={onSlideChange} />)
    const iframeWindow = getIframeWindow()

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: DECK_SLIDE_CHANGE_MESSAGE_TYPE, index: 1 },
        source: window,
      }))
    })

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('0')

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: DECK_SLIDE_CHANGE_MESSAGE_TYPE, index: 1 },
        source: iframeWindow,
      }))
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Active slide')).toHaveTextContent('1')
    })
    expect(onSlideChange).toHaveBeenCalledWith(1)
  })

  it('uses preview arrow keys for shell navigation', async () => {
    render(<NavigationHarness />)
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'ArrowRight',
      }))
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Active slide')).toHaveTextContent('1')
    })
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: DECK_GOTO_MESSAGE_TYPE, index: 1 },
      '*',
    )
  })

  it('uses present-mode keyboard shortcuts and clamps to available slides', async () => {
    render(<NavigationHarness keyboardMode="present" />)
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'End',
      }))
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Active slide')).toHaveTextContent('2')
    })
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: DECK_GOTO_MESSAGE_TYPE, index: 2 },
      '*',
    )

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'PageDown',
      }))
    })

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('2')
  })

  it('does not hijack keyboard input from typing targets', () => {
    render(<NavigationHarness />)
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')
    const input = screen.getByLabelText('Slide title')

    input.focus()
    fireEvent.keyDown(input, { key: 'ArrowRight' })

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('0')
    expect(postMessage).not.toHaveBeenCalled()
  })
})
