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
} from '@ark/deck-core/deck-bridge.ts'
import {
  DECK_BRIDGE_POST_MESSAGE_TARGET,
  OPAQUE_SANDBOX_ORIGIN,
  resolveSandboxOrigin,
} from '@ark/runtime-registry/sandbox-origin.ts'
import type { DeckRuntimeMode } from '@/lib/deck-runtime'
import plainCssDeck from '@fixtures/plain-css-deck.html?raw'
import revealRegistryDeck from '@fixtures/reveal-registry-deck.html?raw'

import { useDeckSlideNavigation, type DeckNavOptions } from './useDeckSlideNavigation'

type HarnessProps = {
  enabled?: boolean
  html?: string
  initialSlideIndex?: number
  keyboardMode?: DeckNavOptions['keyboardMode']
  onDeckReady?: DeckNavOptions['onDeckReady']
  onRuntimeError?: DeckNavOptions['onRuntimeError']
  onSlideChange?: (index: number) => void
  runtimeMode?: DeckRuntimeMode
  slideCount?: number
  syncOnLoad?: boolean
  sandboxOrigin?: string | null
}

function NavigationHarness({
  enabled = true,
  html = plainCssDeck,
  initialSlideIndex = 0,
  keyboardMode = 'preview',
  onDeckReady,
  onRuntimeError,
  onSlideChange,
  runtimeMode = 'static',
  slideCount = 3,
  syncOnLoad = false,
  sandboxOrigin = null,
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
      runtimeMode,
      syncOnLoad,
      sandboxOrigin,
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
  const sandboxOrigin = resolveSandboxOrigin()

  it('posts goto messages and commits the active slide when goToSlide is called', async () => {
    const user = userEvent.setup()
    render(<NavigationHarness sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')

    await user.click(screen.getByRole('button', { name: 'Go to third' }))

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('2')
    expect(postMessage).toHaveBeenCalledWith(
      createDeckGotoMessage(2),
      DECK_BRIDGE_POST_MESSAGE_TARGET,
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

  it('accepts opaque-origin bridge messages from the preview iframe', async () => {
    const onSlideChange = vi.fn()
    render(<NavigationHarness onSlideChange={onSlideChange} sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckSlideChangeMessage(1),
          origin: OPAQUE_SANDBOX_ORIGIN,
          source: iframeWindow,
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Active slide')).toHaveTextContent('1')
    })
    expect(onSlideChange).toHaveBeenCalledWith(1)
  })

  it('accepts slide-change acknowledgements only from the preview iframe and sandbox origin', async () => {
    const onSlideChange = vi.fn()
    render(<NavigationHarness onSlideChange={onSlideChange} sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckSlideChangeMessage(1),
          origin: 'http://evil.test',
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('0')

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckSlideChangeMessage(1),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
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
    render(<NavigationHarness onDeckReady={onDeckReady} sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckReadyMessage(1, 3, metadata),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
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

  it('syncs the requested initial slide when a new iframe reports ready at slide 0', async () => {
    const metadata = createDeckMetadata({
      runtime: 'plain',
      title: 'Demo',
      previewMode: 'css-only',
    })
    render(
      <NavigationHarness initialSlideIndex={1} sandboxOrigin={sandboxOrigin} syncOnLoad={true} />,
    )
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('1')

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckSlideChangeMessage(0),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckReadyMessage(0, 3, metadata),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Active slide')).toHaveTextContent('1')
    })
    expect(postMessage).toHaveBeenCalledWith(
      createDeckGotoMessage(1),
      DECK_BRIDGE_POST_MESSAGE_TARGET,
    )
  })

  it('forwards runtime errors from the preview iframe', async () => {
    const onRuntimeError = vi.fn()
    render(<NavigationHarness onRuntimeError={onRuntimeError} sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckRuntimeErrorMessage('boom', 'deck.js'),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(onRuntimeError).toHaveBeenCalledWith('boom', 'deck.js')
  })

  it('uses preview arrow keys for shell navigation', async () => {
    render(<NavigationHarness sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'ArrowRight',
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Active slide')).toHaveTextContent('1')
    })
    expect(postMessage).toHaveBeenLastCalledWith(
      createDeckGotoMessage(1),
      DECK_BRIDGE_POST_MESSAGE_TARGET,
    )
  })

  it('uses present-mode keyboard shortcuts and clamps to available slides', async () => {
    render(<NavigationHarness keyboardMode="present" sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'End',
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Active slide')).toHaveTextContent('2')
    })
    expect(postMessage).toHaveBeenLastCalledWith(
      createDeckGotoMessage(2),
      DECK_BRIDGE_POST_MESSAGE_TARGET,
    )

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'PageDown',
        }),
      )
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

  it('does not hijack arrow keys from contenteditable text editing', () => {
    render(
      <div>
        <NavigationHarness />
        <div aria-label="Editable heading" contentEditable suppressContentEditableWarning>
          Heading
        </div>
      </div>,
    )
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')
    const editable = screen.getByLabelText('Editable heading')

    editable.focus()
    fireEvent.keyDown(editable, { key: 'ArrowRight' })

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('0')
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('handles reveal slide-change acknowledgements for registry decks', async () => {
    const onSlideChange = vi.fn()
    const metadata = createDeckMetadata({
      runtime: 'reveal',
      title: 'Reveal Registry Deck',
      previewMode: 'full-js',
    })

    render(
      <NavigationHarness
        html={revealRegistryDeck}
        onSlideChange={onSlideChange}
        runtimeMode="reveal"
        sandboxOrigin={sandboxOrigin}
        slideCount={2}
      />,
    )
    const iframeWindow = getIframeWindow()

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckSlideChangeMessage(1),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Active slide')).toHaveTextContent('1')
    })
    expect(onSlideChange).toHaveBeenCalledWith(1)

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckReadyMessage(0, 2, metadata),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Active slide')).toHaveTextContent('0')
    })
  })
})
