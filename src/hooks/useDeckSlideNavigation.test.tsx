import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  createDeckGotoMessage,
  createDeckReadyMessage,
  createDeckRuntimeErrorMessage,
  createDeckSlideChangeMessage,
  createDeckMetadata,
  type PreviewMode,
} from '../../shared/deck-bridge.ts'
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
  onDeckReady?: DeckNavOptions['onDeckReady']
  onRuntimeError?: DeckNavOptions['onRuntimeError']
  onSlideChange?: (index: number) => void
  previewMode?: PreviewMode
  slideCount?: number
  syncOnLoad?: boolean
}

function NavigationHarness({
  enabled = true,
  html = plainCssDeck,
  initialSlideIndex = 0,
  keyboardMode = 'preview',
  onDeckReady,
  onRuntimeError,
  onSlideChange,
  previewMode = 'css-only',
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
      onDeckReady,
      onRuntimeError,
      onSlideChange,
      previewMode,
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
      createDeckGotoMessage(2),
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
        data: createDeckSlideChangeMessage(1),
        source: window,
      }))
    })

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('0')

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: createDeckSlideChangeMessage(1),
        source: iframeWindow,
      }))
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Active slide')).toHaveTextContent('1')
    })
    expect(onSlideChange).toHaveBeenCalledWith(1)
  })

  it('handles deck-ready messages from the preview iframe', async () => {
    const onDeckReady = vi.fn()
    const metadata = createDeckMetadata({
      runtime: 'plain',
      title: 'Demo',
      previewMode: 'css-only',
    })
    render(<NavigationHarness onDeckReady={onDeckReady} />)
    const iframeWindow = getIframeWindow()

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: createDeckReadyMessage(1, 3, metadata),
        source: iframeWindow,
      }))
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Active slide')).toHaveTextContent('1')
    })
    expect(onDeckReady).toHaveBeenCalledWith({
      index: 1,
      slideCount: 3,
      metadata,
    })
  })

  it('forwards runtime errors from the preview iframe', async () => {
    const onRuntimeError = vi.fn()
    render(<NavigationHarness onRuntimeError={onRuntimeError} />)
    const iframeWindow = getIframeWindow()

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: createDeckRuntimeErrorMessage('boom', 'deck.js'),
        source: iframeWindow,
      }))
    })

    expect(onRuntimeError).toHaveBeenCalledWith('boom', 'deck.js')
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
      createDeckGotoMessage(1),
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
      createDeckGotoMessage(2),
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
