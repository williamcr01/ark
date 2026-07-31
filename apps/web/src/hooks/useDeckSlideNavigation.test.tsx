import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  createDeckGotoMessage,
  createDeckPatchSlidesMessage,
  createDeckPatchSlidesResultMessage,
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
  onSlidePatchFailed?: () => void
  reloadRevision?: number
  runtimeMode?: DeckRuntimeMode
  slideCount?: number
  syncOnLoad?: boolean
  sandboxOrigin?: string | null
  canPostToFrame?: () => boolean
  shouldAcceptInbound?: () => boolean
}

function NavigationHarness({
  enabled = true,
  html = plainCssDeck,
  initialSlideIndex = 0,
  keyboardMode = 'preview',
  onDeckReady,
  onRuntimeError,
  onSlideChange,
  onSlidePatchFailed,
  reloadRevision = 0,
  runtimeMode = 'static',
  slideCount = 3,
  syncOnLoad = false,
  sandboxOrigin = null,
  canPostToFrame,
  shouldAcceptInbound,
}: HarnessProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { activeSlideIndex, goToSlide, patchSlides } = useDeckSlideNavigation(
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
      onSlidePatchFailed,
      reloadRevision,
      runtimeMode,
      syncOnLoad,
      sandboxOrigin,
      canPostToFrame,
      shouldAcceptInbound,
    },
  )

  return (
    <div>
      <iframe ref={iframeRef} title="Deck preview" />
      <output aria-label="Active slide">{activeSlideIndex}</output>
      <button onClick={() => goToSlide(2)} type="button">
        Go to third
      </button>
      <button
        onClick={() =>
          patchSlides({
            operations: [
              { op: 'remove', index: 1 },
              { op: 'insert', index: 1, html: '<section class="slide">Patched</section>' },
            ],
            slideCount,
            slideIndexMap: [0, -1, 2],
          })
        }
        type="button"
      >
        Patch slides
      </button>
      <button
        onClick={() =>
          patchSlides({
            operations: [
              { op: 'insert', index: 0, html: '<section class="slide">Intro</section>' },
            ],
            slideCount: slideCount + 1,
            slideIndexMap: Array.from({ length: slideCount }, (_, index) => index + 1),
          })
        }
        type="button"
      >
        Patch insert before
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

  it('applies initialSlideIndex when html first arrives after an empty mount', () => {
    const { rerender } = render(
      <NavigationHarness
        html=""
        initialSlideIndex={2}
        sandboxOrigin={sandboxOrigin}
        slideCount={0}
      />,
    )

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('0')

    rerender(
      <NavigationHarness
        html={plainCssDeck}
        initialSlideIndex={2}
        sandboxOrigin={sandboxOrigin}
        slideCount={3}
      />,
    )

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('2')
  })

  it('keeps the active slide across html replacements', () => {
    const { rerender } = render(
      <NavigationHarness
        html=""
        initialSlideIndex={2}
        sandboxOrigin={sandboxOrigin}
        slideCount={0}
      />,
    )

    rerender(
      <NavigationHarness
        html={plainCssDeck}
        initialSlideIndex={2}
        sandboxOrigin={sandboxOrigin}
        slideCount={3}
      />,
    )
    expect(screen.getByLabelText('Active slide')).toHaveTextContent('2')

    rerender(
      <NavigationHarness
        html={`${plainCssDeck}\n`}
        initialSlideIndex={2}
        sandboxOrigin={sandboxOrigin}
        slideCount={3}
      />,
    )
    expect(screen.getByLabelText('Active slide')).toHaveTextContent('2')
  })

  it('pushes the preserved slide back to a reloaded frame that reports slide 0', async () => {
    const metadata = createDeckMetadata({
      runtime: 'plain',
      title: 'Demo',
      previewMode: 'css-only',
    })
    const { rerender } = render(
      <NavigationHarness initialSlideIndex={2} sandboxOrigin={sandboxOrigin} />,
    )
    const iframeWindow = getIframeWindow()

    rerender(
      <NavigationHarness
        html={`${plainCssDeck}\n`}
        initialSlideIndex={2}
        sandboxOrigin={sandboxOrigin}
      />,
    )

    const postMessage = vi.spyOn(iframeWindow, 'postMessage')

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckReadyMessage(0, 3, metadata),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Active slide')).toHaveTextContent('2')
    })
    expect(postMessage).toHaveBeenCalledWith(
      createDeckGotoMessage(2),
      DECK_BRIDGE_POST_MESSAGE_TARGET,
    )
  })

  it('clamps the active slide when the deck loses slides in place', () => {
    const { rerender } = render(<NavigationHarness sandboxOrigin={sandboxOrigin} slideCount={5} />)

    act(() => {
      screen.getByRole('button', { name: 'Go to third' }).click()
    })
    expect(screen.getByLabelText('Active slide')).toHaveTextContent('2')

    rerender(<NavigationHarness sandboxOrigin={sandboxOrigin} slideCount={2} />)

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('1')
  })

  it('follows the surviving slide when an earlier slide is inserted in the html', () => {
    const withIntro = plainCssDeck.replace(
      '<section class="slide"',
      '<section class="slide" data-title="Intro"><h1>Intro</h1></section><section class="slide"',
    )
    const { rerender } = render(
      <NavigationHarness initialSlideIndex={1} sandboxOrigin={sandboxOrigin} />,
    )

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('1')

    rerender(
      <NavigationHarness
        html={withIntro}
        initialSlideIndex={1}
        sandboxOrigin={sandboxOrigin}
        slideCount={4}
      />,
    )

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('2')
  })

  it('pushes the preserved slide after a same-html reload revision bump', async () => {
    const metadata = createDeckMetadata({
      runtime: 'plain',
      title: 'Demo',
      previewMode: 'css-only',
    })
    const { rerender } = render(
      <NavigationHarness initialSlideIndex={2} reloadRevision={0} sandboxOrigin={sandboxOrigin} />,
    )
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')

    rerender(
      <NavigationHarness initialSlideIndex={2} reloadRevision={1} sandboxOrigin={sandboxOrigin} />,
    )

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckReadyMessage(0, 3, metadata),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Active slide')).toHaveTextContent('2')
    })
    expect(postMessage).toHaveBeenCalledWith(
      createDeckGotoMessage(2),
      DECK_BRIDGE_POST_MESSAGE_TARGET,
    )
  })

  it('posts slide patches to the frame at the preserved slide', async () => {
    const user = userEvent.setup()
    render(<NavigationHarness sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')

    await user.click(screen.getByRole('button', { name: 'Go to third' }))
    await user.click(screen.getByRole('button', { name: 'Patch slides' }))

    expect(postMessage).toHaveBeenLastCalledWith(
      createDeckPatchSlidesMessage(
        'slide-patch-1',
        [
          { op: 'remove', index: 1 },
          { op: 'insert', index: 1, html: '<section class="slide">Patched</section>' },
        ],
        2,
      ),
      DECK_BRIDGE_POST_MESSAGE_TARGET,
    )
  })

  it('posts slide patches at the identity-mapped slide after an earlier insert', async () => {
    const user = userEvent.setup()
    render(<NavigationHarness sandboxOrigin={sandboxOrigin} slideCount={3} />)
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')

    await user.click(screen.getByRole('button', { name: 'Go to third' }))
    await user.click(screen.getByRole('button', { name: 'Patch insert before' }))

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('3')
    expect(postMessage).toHaveBeenLastCalledWith(
      createDeckPatchSlidesMessage(
        'slide-patch-1',
        [{ op: 'insert', index: 0, html: '<section class="slide">Intro</section>' }],
        3,
      ),
      DECK_BRIDGE_POST_MESSAGE_TARGET,
    )
  })

  it('reports a failed slide patch so the shell can reload', async () => {
    const user = userEvent.setup()
    const onSlidePatchFailed = vi.fn()
    render(
      <NavigationHarness onSlidePatchFailed={onSlidePatchFailed} sandboxOrigin={sandboxOrigin} />,
    )
    const iframeWindow = getIframeWindow()

    await user.click(screen.getByRole('button', { name: 'Patch slides' }))

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckPatchSlidesResultMessage('slide-patch-1', false, 0),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(onSlidePatchFailed).toHaveBeenCalledTimes(1)
  })

  it('reports a stale refused slide patch so the shell can reload', async () => {
    const user = userEvent.setup()
    const onSlidePatchFailed = vi.fn()
    render(
      <NavigationHarness onSlidePatchFailed={onSlidePatchFailed} sandboxOrigin={sandboxOrigin} />,
    )
    const iframeWindow = getIframeWindow()

    await user.click(screen.getByRole('button', { name: 'Patch slides' }))
    await user.click(screen.getByRole('button', { name: 'Patch slides' }))

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckPatchSlidesResultMessage('slide-patch-1', false, 0),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(onSlidePatchFailed).toHaveBeenCalledTimes(1)
  })

  it('reports a slide patch that produced an unexpected slide count', async () => {
    const user = userEvent.setup()
    const onSlidePatchFailed = vi.fn()
    render(
      <NavigationHarness onSlidePatchFailed={onSlidePatchFailed} sandboxOrigin={sandboxOrigin} />,
    )
    const iframeWindow = getIframeWindow()

    await user.click(screen.getByRole('button', { name: 'Patch slides' }))

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckPatchSlidesResultMessage('slide-patch-1', true, 7),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(onSlidePatchFailed).toHaveBeenCalledTimes(1)
  })

  it('accepts a slide patch the runtime applied as expected', async () => {
    const user = userEvent.setup()
    const onSlidePatchFailed = vi.fn()
    render(
      <NavigationHarness onSlidePatchFailed={onSlidePatchFailed} sandboxOrigin={sandboxOrigin} />,
    )
    const iframeWindow = getIframeWindow()

    await user.click(screen.getByRole('button', { name: 'Patch slides' }))

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckPatchSlidesResultMessage('slide-patch-1', true, 3),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(onSlidePatchFailed).not.toHaveBeenCalled()
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

  it('keeps arrow keys for slide navigation when a resize separator is focused', async () => {
    render(
      <div>
        <NavigationHarness sandboxOrigin={sandboxOrigin} />
        <div role="separator" tabIndex={0} aria-orientation="horizontal" aria-label="Chat resize">
          Resize
        </div>
      </div>,
    )
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')
    const separator = screen.getByRole('separator', { name: 'Chat resize' })

    separator.focus()
    expect(separator).toHaveFocus()

    act(() => {
      separator.dispatchEvent(
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

  it('does not post goto when canPostToFrame returns false', async () => {
    const user = userEvent.setup()
    render(<NavigationHarness canPostToFrame={() => false} sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')

    await user.click(screen.getByRole('button', { name: 'Go to third' }))

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('2')
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('ignores inbound messages when shouldAcceptInbound returns false', async () => {
    const onSlideChange = vi.fn()
    render(
      <NavigationHarness
        onSlideChange={onSlideChange}
        sandboxOrigin={sandboxOrigin}
        shouldAcceptInbound={() => false}
      />,
    )
    const iframeWindow = getIframeWindow()

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createDeckSlideChangeMessage(2),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Active slide')).toHaveTextContent('0')
    expect(onSlideChange).not.toHaveBeenCalled()
  })
})
