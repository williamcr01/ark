import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef, type RefObject } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  EDITOR_BRIDGE_PROTOCOL_VERSION,
  EDITOR_CONNECT_ACK_MESSAGE_TYPE,
  EDITOR_CONNECT_MESSAGE_TYPE,
  createEditorDeleteRequestMessage,
  createEditorEnableMessage,
  createEditorErrorMessage,
  createEditorGeometryMessage,
  createEditorHoverMessage,
  createEditorInsertRequestMessage,
  createEditorReadyMessage,
  createEditorSelectionChangeMessage,
  createEditorShortcutMessage,
  createEditorTextCommitMessage,
  createEditorTextEditStateMessage,
  createEditorTransformCancelMessage,
  createEditorTransformEndMessage,
  createEditorTransformCommitMessage,
  createEditorTransformPreviewMessage,
} from '@ark/deck-core/deck-editor-bridge.ts'
import {
  OPAQUE_SANDBOX_ORIGIN,
  resolveSandboxOrigin,
} from '@ark/runtime-registry/sandbox-origin.ts'

import { useDeckEditorBridge } from './useDeckEditorBridge'

const TEST_SESSION_HANDSHAKE = 'test-editor-session'
let testRuntimeMessages: unknown[] = []

function EditorHarness({
  enabled = true,
  sandboxOrigin = null,
  iframeGenerationKey = 'test-frame',
  sessionHandshake = TEST_SESSION_HANDSHAKE,
  forwardPublicMessages = sessionHandshake === TEST_SESSION_HANDSHAKE,
  canPostToFrame,
  shouldAcceptInbound,
  onSelectionChange,
}: {
  enabled?: boolean
  sandboxOrigin?: string | null
  iframeGenerationKey?: string
  sessionHandshake?: string | null
  forwardPublicMessages?: boolean
  canPostToFrame?: () => boolean
  shouldAcceptInbound?: () => boolean
  onSelectionChange?: (selection: { elementId: string } | null) => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const previousGenerationKeyRef = useRef(iframeGenerationKey)
  const bridge = useDeckEditorBridge(iframeRef, {
    enabled,
    activeSlideIndex: 0,
    sandboxOrigin,
    iframeGenerationKey,
    sessionHandshake,
    canPostToFrame,
    shouldAcceptInbound,
    onSelectionChange,
  })
  const { enableEditor } = bridge

  useEffect(() => {
    if (previousGenerationKeyRef.current === iframeGenerationKey) {
      return
    }

    previousGenerationKeyRef.current = iframeGenerationKey

    if (enabled) {
      enableEditor(0)
    }
  }, [enableEditor, enabled, iframeGenerationKey])

  return (
    <div>
      <iframe key={iframeGenerationKey} ref={iframeRef} title="Deck preview" />
      <TestEditorRuntimeConnection
        forwardPublicMessages={forwardPublicMessages}
        iframeGenerationKey={iframeGenerationKey}
        iframeRef={iframeRef}
        sandboxOrigin={sandboxOrigin}
        sessionHandshake={sessionHandshake}
      />
      <output aria-label="Editor ready">{bridge.editorReady ? 'ready' : 'pending'}</output>
      <output aria-label="Selection">{bridge.selection?.elementId ?? 'none'}</output>
      <output aria-label="Geometry">{bridge.geometry ? 'geometry' : 'none'}</output>
      <output aria-label="Selection surface">{bridge.selection?.surface ?? 'light'}</output>
      <output aria-label="Hover geometry">{bridge.hoverGeometry ? 'geometry' : 'none'}</output>
      <output aria-label="Hover surface">{bridge.hover?.surface ?? 'light'}</output>
      <output aria-label="Shortcut">
        {bridge.lastShortcutRequest
          ? `${bridge.lastShortcutRequest.action}:${bridge.lastShortcutRequest.sequence}`
          : 'none'}
      </output>
      <output aria-label="Editor error">{bridge.editorError ?? 'none'}</output>
      <output aria-label="Text commit">{bridge.lastTextCommit?.text ?? 'none'}</output>
      <output aria-label="Transform commit">{bridge.transformCommit?.elementId ?? 'none'}</output>
      <output aria-label="Transform preview">{bridge.transformPreview?.elementId ?? 'none'}</output>
      <output aria-label="Transform cancel">{bridge.transformCancelSequence}</output>
      <output aria-label="Delete request">{bridge.lastDeleteRequest?.elementId ?? 'none'}</output>
      <output aria-label="Insert request">{bridge.lastInsertRequest?.kind ?? 'none'}</output>
      <button onClick={() => bridge.enableEditor(0)} type="button">
        Enable editor
      </button>
    </div>
  )
}

function TestEditorRuntimeConnection({
  forwardPublicMessages,
  iframeGenerationKey,
  iframeRef,
  sandboxOrigin,
  sessionHandshake,
}: {
  forwardPublicMessages: boolean
  iframeGenerationKey: string
  iframeRef: RefObject<HTMLIFrameElement | null>
  sandboxOrigin: string | null
  sessionHandshake: string | null
}) {
  useEffect(() => {
    if (sessionHandshake !== TEST_SESSION_HANDSHAKE || !sandboxOrigin) {
      return
    }

    const iframeWindow = iframeRef.current?.contentWindow

    if (!iframeWindow) {
      return
    }

    const channel = new MessageChannel()
    const runtimePort = channel.port1
    runtimePort.onmessage = (event) => {
      testRuntimeMessages.push(event.data)
    }
    runtimePort.start()

    const forwardMessage = (event: MessageEvent) => {
      if (
        !forwardPublicMessages ||
        event.source !== iframeWindow ||
        event.origin !== sandboxOrigin
      ) {
        return
      }

      runtimePort.postMessage(event.data)
    }

    window.addEventListener('message', forwardMessage)
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: EDITOR_CONNECT_MESSAGE_TYPE,
          handshake: sessionHandshake,
          protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
        },
        origin: sandboxOrigin,
        source: iframeWindow,
        ports: [channel.port2],
      }),
    )

    return () => {
      window.removeEventListener('message', forwardMessage)
      runtimePort.close()
    }
  }, [forwardPublicMessages, iframeGenerationKey, iframeRef, sandboxOrigin, sessionHandshake])

  return null
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

  beforeEach(() => {
    testRuntimeMessages = []
  })

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

    await waitFor(() => {
      expect(screen.getByLabelText('Editor ready')).toHaveTextContent('ready')
    })

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

  it('uses an authenticated MessagePort and ignores public editor-message forgeries', async () => {
    const user = userEvent.setup()
    const sessionHandshake = 'editor-session-capability'
    render(<EditorHarness sandboxOrigin={sandboxOrigin} sessionHandshake={sessionHandshake} />)
    const iframeWindow = getIframeWindow()
    const channel = new MessageChannel()
    const shellMessages: unknown[] = []

    channel.port1.onmessage = (event) => {
      shellMessages.push(event.data)
    }
    channel.port1.start()

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: EDITOR_CONNECT_MESSAGE_TYPE,
            handshake: sessionHandshake,
            protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
          },
          origin: sandboxOrigin,
          source: iframeWindow,
          ports: [channel.port2],
        }),
      )
    })

    await waitFor(() => {
      expect(shellMessages).toContainEqual({
        type: EDITOR_CONNECT_ACK_MESSAGE_TYPE,
        protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
      })
    })

    await user.click(screen.getByRole('button', { name: 'Enable editor' }))

    await waitFor(() => {
      expect(shellMessages).toContainEqual(createEditorEnableMessage(0))
    })

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorSelectionChangeMessage({
            elementId: 'forged-public-selection',
            slideIndex: 0,
            slideId: null,
            tagName: 'h1',
            locked: false,
            managed: false,
            editableKind: null,
            textPreview: 'Forged',
          }),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Selection')).toHaveTextContent('none')

    channel.port1.postMessage(
      createEditorSelectionChangeMessage({
        elementId: 'authenticated-selection',
        slideIndex: 0,
        slideId: null,
        tagName: 'h1',
        locked: false,
        managed: false,
        editableKind: null,
        textPreview: 'Authenticated',
      }),
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Selection')).toHaveTextContent('authenticated-selection')
    })

    channel.port1.close()
  })

  it('clears overlay geometry when the runtime deselects', async () => {
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

    expect(screen.getByLabelText('Selection')).toHaveTextContent('ark-el-title')
    expect(screen.getByLabelText('Geometry')).toHaveTextContent('geometry')

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorSelectionChangeMessage(null),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Selection')).toHaveTextContent('none')
    expect(screen.getByLabelText('Geometry')).toHaveTextContent('none')
  })

  it('clears overlay geometry when selection identity changes', async () => {
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

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorSelectionChangeMessage({
            elementId: 'ark-el-body',
            slideIndex: 0,
            slideId: null,
            tagName: 'p',
            locked: false,
            managed: false,
            editableKind: null,
            textPreview: 'Body',
          }),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Selection')).toHaveTextContent('ark-el-body')
    expect(screen.getByLabelText('Geometry')).toHaveTextContent('none')
  })

  it('ignores late geometry for a previously selected element', async () => {
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
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorSelectionChangeMessage({
            elementId: 'ark-el-body',
            slideIndex: 0,
            slideId: null,
            tagName: 'p',
            locked: false,
            managed: false,
            editableKind: null,
            textPreview: 'Body',
          }),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
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

    expect(screen.getByLabelText('Selection')).toHaveTextContent('ark-el-body')
    expect(screen.getByLabelText('Geometry')).toHaveTextContent('none')
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

    await user.click(screen.getByRole('button', { name: 'Enable editor' }))

    await waitFor(() => {
      expect(testRuntimeMessages).toContainEqual(createEditorEnableMessage(0))
    })
  })

  it('ends an iframe transform when the pointer is released in the shell', async () => {
    render(<EditorHarness sandboxOrigin={OPAQUE_SANDBOX_ORIGIN} />)

    act(() => {
      window.dispatchEvent(new Event('pointerup'))
    })

    await waitFor(() => {
      expect(testRuntimeMessages).toContainEqual(createEditorTransformEndMessage())
    })
  })

  it('cancels an iframe transform when the shell pointer is cancelled', async () => {
    render(<EditorHarness sandboxOrigin={OPAQUE_SANDBOX_ORIGIN} />)

    act(() => {
      window.dispatchEvent(new Event('pointercancel'))
    })

    await waitFor(() => {
      expect(testRuntimeMessages).toContainEqual(createEditorTransformCancelMessage())
    })
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

  it('stores normalized geometry responses for the active selection', async () => {
    render(<EditorHarness sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()

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

    expect(screen.getByLabelText('Selection')).toHaveTextContent('ark-el-title')
    expect(screen.getByLabelText('Geometry')).toHaveTextContent('geometry')
  })

  it('stores inline hover geometry, adaptive surfaces, and shortcut requests', async () => {
    render(<EditorHarness sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorHoverMessage(
            0,
            'ark-el-title',
            { x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
            undefined,
            'dark',
          ),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorShortcutMessage('undo'),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorShortcutMessage('undo'),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Hover geometry')).toHaveTextContent('geometry')
    expect(screen.getByLabelText('Hover surface')).toHaveTextContent('dark')
    expect(screen.getByLabelText('Shortcut')).toHaveTextContent('undo:2')

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorHoverMessage(0, 'ark-el-body'),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorGeometryMessage('ark-el-body', 0, {
            x: 0.2,
            y: 0.3,
            width: 0.4,
            height: 0.1,
          }),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Hover geometry')).toHaveTextContent('none')
  })

  it('clears transform state when the runtime cancels a gesture', async () => {
    render(<EditorHarness sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()
    const geometry = { x: 0.1, y: 0.2, width: 0.5, height: 0.1 }

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorTransformPreviewMessage('ark-el-title', 0, geometry),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorTransformCommitMessage('ark-el-title', 0, geometry),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorTransformCancelMessage(),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Transform preview')).toHaveTextContent('none')
    expect(screen.getByLabelText('Transform commit')).toHaveTextContent('none')
    expect(screen.getByLabelText('Transform cancel')).toHaveTextContent('1')
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

    await waitFor(() => {
      expect(screen.getByLabelText('Editor ready')).toHaveTextContent('ready')
    })

    rerender(<EditorHarness sandboxOrigin={sandboxOrigin} iframeGenerationKey="frame-2" />)

    expect(screen.getByLabelText('Editor ready')).toHaveTextContent('pending')

    const newIframeWindow = getIframeWindow()

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorReadyMessage(0),
          origin: sandboxOrigin,
          source: newIframeWindow,
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Editor ready')).toHaveTextContent('ready')
    })

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

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorSelectionChangeMessage({
            elementId: 'fresh-selection',
            slideIndex: 0,
            slideId: null,
            tagName: 'h1',
            locked: false,
            managed: false,
            editableKind: null,
            textPreview: 'Fresh',
          }),
          origin: sandboxOrigin,
          source: newIframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Selection')).toHaveTextContent('fresh-selection')
  })

  it('preserves in-flight insert requests across same-iframe re-enable', async () => {
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
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorSelectionChangeMessage({
            elementId: 'selected-before-enable',
            slideIndex: 0,
            slideId: null,
            tagName: 'h1',
            locked: false,
            managed: false,
            editableKind: null,
            textPreview: 'Selected',
          }),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorGeometryMessage('selected-before-enable', 0, {
            x: 0.1,
            y: 0.1,
            width: 0.2,
            height: 0.1,
          }),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorInsertRequestMessage('text-box', 0, {
            x: 0.1,
            y: 0.2,
            width: 0.3,
            height: 0.1,
          }),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Editor ready')).toHaveTextContent('ready')
    expect(screen.getByLabelText('Selection')).toHaveTextContent('selected-before-enable')
    expect(screen.getByLabelText('Geometry')).toHaveTextContent('geometry')
    expect(screen.getByLabelText('Insert request')).toHaveTextContent('text-box')

    await userEvent.click(screen.getByRole('button', { name: 'Enable editor' }))

    expect(screen.getByLabelText('Editor ready')).toHaveTextContent('ready')
    expect(screen.getByLabelText('Insert request')).toHaveTextContent('text-box')
    expect(screen.getByLabelText('Selection')).toHaveTextContent('none')
    expect(screen.getByLabelText('Geometry')).toHaveTextContent('none')
  })

  it('drops in-flight insert requests when the preview iframe remounts', async () => {
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
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorInsertRequestMessage('text-box', 0, {
            x: 0.1,
            y: 0.2,
            width: 0.3,
            height: 0.1,
          }),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Insert request')).toHaveTextContent('text-box')

    rerender(<EditorHarness sandboxOrigin={sandboxOrigin} iframeGenerationKey="frame-2" />)

    expect(screen.getByLabelText('Editor ready')).toHaveTextContent('pending')
    expect(screen.getByLabelText('Insert request')).toHaveTextContent('none')
  })

  it('tracks iframe text-edit lifecycle state', async () => {
    function TextEditHarness() {
      const iframeRef = useRef<HTMLIFrameElement>(null)
      const bridge = useDeckEditorBridge(iframeRef, {
        enabled: true,
        activeSlideIndex: 0,
        sandboxOrigin,
        iframeGenerationKey: 'test-frame',
        sessionHandshake: TEST_SESSION_HANDSHAKE,
      })

      return (
        <div>
          <iframe ref={iframeRef} title="Deck preview" />
          <TestEditorRuntimeConnection
            forwardPublicMessages
            iframeGenerationKey="test-frame"
            iframeRef={iframeRef}
            sandboxOrigin={sandboxOrigin}
            sessionHandshake={TEST_SESSION_HANDSHAKE}
          />
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

  it('does not post when canPostToFrame returns false', async () => {
    const user = userEvent.setup()
    render(<EditorHarness canPostToFrame={() => false} sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')

    await user.click(screen.getByRole('button', { name: 'Enable editor' }))

    expect(postMessage).not.toHaveBeenCalled()
  })

  it('ignores inbound editor messages when shouldAcceptInbound returns false', async () => {
    render(<EditorHarness sandboxOrigin={sandboxOrigin} shouldAcceptInbound={() => false} />)
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

    expect(screen.getByLabelText('Editor ready')).toHaveTextContent('pending')
  })
})
