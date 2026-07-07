import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  createEditorDeleteRequestMessage,
  createEditorEnableMessage,
  createEditorErrorMessage,
  createEditorGeometryMessage,
  createEditorInsertRequestMessage,
  createEditorReadyMessage,
  createEditorSelectionChangeMessage,
  createEditorTextCommitMessage,
  createEditorTextEditStateMessage,
  createEditorTransformCommitMessage,
} from '../../shared/deck-editor-bridge.ts'
import {
  DECK_BRIDGE_POST_MESSAGE_TARGET,
  OPAQUE_SANDBOX_ORIGIN,
  resolveSandboxOrigin,
} from '../../shared/sandbox-origin.ts'

import { useDeckEditorBridge } from './useDeckEditorBridge'

function EditorHarness({
  enabled = true,
  sandboxOrigin = null,
  iframeGenerationKey = 'test-frame',
  onSelectionChange,
}: {
  enabled?: boolean
  sandboxOrigin?: string | null
  iframeGenerationKey?: string
  onSelectionChange?: (selection: { elementId: string } | null) => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bridge = useDeckEditorBridge(iframeRef, {
    enabled,
    activeSlideIndex: 0,
    sandboxOrigin,
    iframeGenerationKey,
    onSelectionChange,
  })

  return (
    <div>
      <iframe ref={iframeRef} title="Deck preview" />
      <output aria-label="Editor ready">{bridge.editorReady ? 'ready' : 'pending'}</output>
      <output aria-label="Selection">{bridge.selection?.elementId ?? 'none'}</output>
      <output aria-label="Geometry">{bridge.geometry ? 'geometry' : 'none'}</output>
      <output aria-label="Editor error">{bridge.editorError ?? 'none'}</output>
      <output aria-label="Text commit">{bridge.lastTextCommit?.text ?? 'none'}</output>
      <output aria-label="Transform commit">{bridge.transformCommit?.elementId ?? 'none'}</output>
      <output aria-label="Delete request">{bridge.lastDeleteRequest?.elementId ?? 'none'}</output>
      <output aria-label="Insert request">{bridge.lastInsertRequest?.kind ?? 'none'}</output>
      <button onClick={() => bridge.enableEditor(0)} type="button">
        Enable editor
      </button>
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

describe('useDeckEditorBridge', () => {
  const sandboxOrigin = resolveSandboxOrigin()

  it('accepts editor runtime messages from the active iframe only', async () => {
    render(<EditorHarness sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorReadyMessage(0),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Editor ready')).toHaveTextContent('ready')

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorSelectionChangeMessage({
            elementId: 'ark-el-title',
            slideIndex: 0,
            slideId: null,
            tagName: 'h1',
            locked: false,
            managed: false,
            editableKind: null,
            textPreview: 'Title',
          }),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Selection')).toHaveTextContent('ark-el-title')
  })

  it('rejects editor messages from non-active frames and hostile origins', async () => {
    render(<EditorHarness sandboxOrigin={sandboxOrigin} />)

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorReadyMessage(0),
          origin: sandboxOrigin,
          source: {} as Window,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorReadyMessage(0),
          origin: 'https://evil.example',
          source: getIframeWindow(),
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'ark:editor-selection-change', selection: { elementId: 'evil' } },
          origin: sandboxOrigin,
          source: getIframeWindow(),
        }),
      )
    })

    expect(screen.getByLabelText('Editor ready')).toHaveTextContent('pending')
    expect(screen.getByLabelText('Selection')).toHaveTextContent('none')
  })

  it('posts validated shell messages to an opaque sandbox iframe', async () => {
    const user = userEvent.setup()
    render(<EditorHarness sandboxOrigin={OPAQUE_SANDBOX_ORIGIN} />)
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')

    await user.click(screen.getByRole('button', { name: 'Enable editor' }))

    expect(postMessage).toHaveBeenCalledWith(
      createEditorEnableMessage(0),
      DECK_BRIDGE_POST_MESSAGE_TARGET,
    )
  })

  it('surfaces bridge errors without throwing', async () => {
    render(<EditorHarness sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorErrorMessage('Element was not found.', 'missing-element'),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Editor error')).toHaveTextContent('Element was not found.')
  })

  it('stores normalized geometry responses separately from selection', async () => {
    render(<EditorHarness sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorGeometryMessage('ark-el-title', 0, {
            x: 0.1,
            y: 0.2,
            width: 0.5,
            height: 0.1,
          }),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Geometry')).toHaveTextContent('geometry')
  })

  it('ignores forged editor commits and mutation requests from hostile origins', async () => {
    const onSelectionChange = vi.fn()
    render(<EditorHarness sandboxOrigin={sandboxOrigin} onSelectionChange={onSelectionChange} />)
    const iframeWindow = getIframeWindow()

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorTextCommitMessage('evil-el', 0, 'Injected', 'Victim', null),
          origin: 'https://evil.example',
          source: iframeWindow,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorTransformCommitMessage('evil-el', 0, {
            x: 0.2,
            y: 0.2,
            width: 0.3,
            height: 0.1,
          }),
          origin: sandboxOrigin,
          source: {} as Window,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorDeleteRequestMessage('evil-el', 0),
          origin: 'https://evil.example',
          source: iframeWindow,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorInsertRequestMessage('text-box', 0, {
            x: 0.1,
            y: 0.1,
            width: 0.2,
            height: 0.1,
          }),
          origin: sandboxOrigin,
          source: {} as Window,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'ark:editor-selection-change', selection: { elementId: 'evil' } },
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Text commit')).toHaveTextContent('none')
    expect(screen.getByLabelText('Transform commit')).toHaveTextContent('none')
    expect(screen.getByLabelText('Delete request')).toHaveTextContent('none')
    expect(screen.getByLabelText('Insert request')).toHaveTextContent('none')
    expect(screen.getByLabelText('Selection')).toHaveTextContent('none')
    expect(onSelectionChange).not.toHaveBeenCalled()
  })

  it('drops runtime messages after the preview iframe generation changes', async () => {
    const { rerender } = render(
      <EditorHarness sandboxOrigin={sandboxOrigin} iframeGenerationKey="frame-1" />,
    )
    const iframeWindow = getIframeWindow()

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorReadyMessage(0),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Editor ready')).toHaveTextContent('ready')

    rerender(<EditorHarness sandboxOrigin={sandboxOrigin} iframeGenerationKey="frame-2" />)

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorSelectionChangeMessage({
            elementId: 'stale-selection',
            slideIndex: 0,
            slideId: null,
            tagName: 'h1',
            locked: false,
            managed: false,
            editableKind: null,
            textPreview: 'Stale',
          }),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorTextCommitMessage('stale-el', 0, 'Injected', 'Original', null),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Selection')).toHaveTextContent('none')
    expect(screen.getByLabelText('Text commit')).toHaveTextContent('none')
  })

  it('tracks iframe text-edit lifecycle state', async () => {
    function TextEditHarness() {
      const iframeRef = useRef<HTMLIFrameElement>(null)
      const bridge = useDeckEditorBridge(iframeRef, {
        enabled: true,
        activeSlideIndex: 0,
        sandboxOrigin,
        iframeGenerationKey: 'test-frame',
      })

      return (
        <div>
          <iframe ref={iframeRef} title="Deck preview" />
          <output aria-label="Text edit active">{bridge.textEditActive ? 'yes' : 'no'}</output>
        </div>
      )
    }

    render(<TextEditHarness />)
    const iframeWindow = getIframeWindow()

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorTextEditStateMessage(true, 'ark-el-title', 0),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Text edit active')).toHaveTextContent('yes')

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorTextEditStateMessage(false),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Text edit active')).toHaveTextContent('no')
  })
})
