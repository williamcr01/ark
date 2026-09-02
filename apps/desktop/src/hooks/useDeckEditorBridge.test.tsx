import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  type EditorTransformPreviewMessage,
} from '@ark/editor-runtime'
import {
  OPAQUE_SANDBOX_ORIGIN,
  resolveSandboxOrigin,
} from '@ark/runtime-registry/sandbox-origin.ts'

import { useDeckEditorBridge } from './useDeckEditorBridge'

const TEST_SESSION_HANDSHAKE = 'test-editor-session'
let testRuntimeGeneration = 0
let testRuntimeMessages: unknown[] = []
let testRuntimePort: MessagePort | null = null

function currentTestHandshake() {
  return `${TEST_SESSION_HANDSHAKE}-${testRuntimeGeneration}`
}

function currentTestFrameKey() {
  return `test-frame-${testRuntimeGeneration}`
}

function EditorHarness({
  enabled = true,
  sandboxOrigin = null,
  iframeGenerationKey = currentTestFrameKey(),
  sessionHandshake = currentTestHandshake(),
  forwardPublicMessages = Boolean(sessionHandshake?.startsWith(TEST_SESSION_HANDSHAKE)),
  canPostToFrame,
  shouldAcceptInbound,
  onSelectionChange,
  transformPreviewListener,
}: {
  enabled?: boolean
  sandboxOrigin?: string | null
  iframeGenerationKey?: string
  sessionHandshake?: string | null
  forwardPublicMessages?: boolean
  canPostToFrame?: () => boolean
  shouldAcceptInbound?: () => boolean
  onSelectionChange?: (selection: { elementId: string } | null) => void
  transformPreviewListener?: (preview: EditorTransformPreviewMessage | null) => void
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
  const { enableEditor, setTransformPreviewListener } = bridge

  useLayoutEffect(() => {
    if (!transformPreviewListener) {
      return
    }

    setTransformPreviewListener(transformPreviewListener)
    return () => setTransformPreviewListener(null)
  }, [setTransformPreviewListener, transformPreviewListener])
  const selectionIdentityRef = useRef(bridge.selection)
  const [selectionIdentityVersion, setSelectionIdentityVersion] = useState(0)

  useEffect(() => {
    if (selectionIdentityRef.current === bridge.selection) {
      return
    }

    selectionIdentityRef.current = bridge.selection
    setSelectionIdentityVersion((version) => version + 1)
  }, [bridge.selection])

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
      <output aria-label="Selections">
        {bridge.selections.map((item) => item.elementId).join(',') || 'none'}
      </output>
      <output aria-label="Selection identity">{selectionIdentityVersion}</output>
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
    if (!sessionHandshake?.startsWith(TEST_SESSION_HANDSHAKE) || !sandboxOrigin) {
      return
    }

    const iframeWindow = iframeRef.current?.contentWindow

    if (!iframeWindow) {
      return
    }

    const channel = new MessageChannel()
    const runtimePort = channel.port1
    const connectionGeneration = testRuntimeGeneration
    testRuntimePort = runtimePort
    runtimePort.onmessage = (event) => {
      if (connectionGeneration !== testRuntimeGeneration) {
        return
      }
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

      try {
        runtimePort.postMessage(event.data)
      } catch {
        // The previous connection may already be closed during remounts.
      }
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
      if (testRuntimePort === runtimePort) {
        testRuntimePort = null
      }
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

async function waitForRuntimeConnection() {
  await waitFor(() => {
    expect(testRuntimePort).not.toBeNull()
    expect(testRuntimeMessages).toContainEqual({
      type: EDITOR_CONNECT_ACK_MESSAGE_TYPE,
      protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
    })
  })
}

async function renderConnected(ui: Parameters<typeof render>[0]) {
  testRuntimePort = null
  testRuntimeMessages = []
  const view = render(ui)
  await waitForRuntimeConnection()
  return view
}

describe('useDeckEditorBridge', () => {
  const sandboxOrigin = resolveSandboxOrigin()

  beforeEach(() => {
    testRuntimeGeneration += 1
    testRuntimeMessages = []
  })

  afterEach(() => {
    cleanup()
    testRuntimeGeneration += 1
    testRuntimeMessages = []
  })

  it('accepts editor runtime messages from the active iframe only', async () => {
    await renderConnected(<EditorHarness sandboxOrigin={sandboxOrigin} />)
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
    await renderConnected(<EditorHarness sandboxOrigin={sandboxOrigin} />)
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

  it('stores the full selection set from ark:editor-selection-change', async () => {
    await renderConnected(<EditorHarness sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()
    const primary = {
      elementId: 'ark-el-title',
      slideIndex: 0,
      slideId: null,
      tagName: 'h1',
      locked: false,
      managed: false,
      editableKind: null,
      textPreview: 'Title',
    }
    const companion = { ...primary, elementId: 'ark-el-body', tagName: 'p', textPreview: 'Body' }

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
          data: createEditorSelectionChangeMessage(companion, [primary, companion]),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Selection')).toHaveTextContent('ark-el-body')
    expect(screen.getByLabelText('Selections')).toHaveTextContent('ark-el-title,ark-el-body')
  })

  it('clears overlay geometry when selection identity changes', async () => {
    await renderConnected(<EditorHarness sandboxOrigin={sandboxOrigin} />)
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
    await renderConnected(<EditorHarness sandboxOrigin={sandboxOrigin} />)
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
    await renderConnected(<EditorHarness sandboxOrigin={sandboxOrigin} />)

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
    await renderConnected(<EditorHarness sandboxOrigin={OPAQUE_SANDBOX_ORIGIN} />)

    await user.click(screen.getByRole('button', { name: 'Enable editor' }))

    await waitFor(() => {
      expect(testRuntimeMessages).toContainEqual(createEditorEnableMessage(0))
    })
  })

  it('ends an iframe transform when the pointer is released in the shell', async () => {
    await renderConnected(<EditorHarness sandboxOrigin={OPAQUE_SANDBOX_ORIGIN} />)

    act(() => {
      window.dispatchEvent(new Event('pointerup'))
    })

    await waitFor(() => {
      expect(testRuntimeMessages).toContainEqual(createEditorTransformEndMessage())
    })
  })

  it('cancels an iframe transform when the shell pointer is cancelled', async () => {
    await renderConnected(<EditorHarness sandboxOrigin={OPAQUE_SANDBOX_ORIGIN} />)

    act(() => {
      window.dispatchEvent(new Event('pointercancel'))
    })

    await waitFor(() => {
      expect(testRuntimeMessages).toContainEqual(createEditorTransformCancelMessage())
    })
  })

  it('surfaces bridge errors without throwing', async () => {
    await renderConnected(<EditorHarness sandboxOrigin={sandboxOrigin} />)
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
    await renderConnected(<EditorHarness sandboxOrigin={sandboxOrigin} />)
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

  it('keeps selection object identity when geometry repeats the same surface', async () => {
    await renderConnected(<EditorHarness sandboxOrigin={sandboxOrigin} />)
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
            surface: 'dark',
          }),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    const identityAfterSelect = screen.getByLabelText('Selection identity').textContent

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorGeometryMessage(
            'ark-el-title',
            0,
            { x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
            null,
            undefined,
            'dark',
          ),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: createEditorGeometryMessage(
            'ark-el-title',
            0,
            { x: 0.12, y: 0.22, width: 0.5, height: 0.1 },
            null,
            undefined,
            'dark',
          ),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Selection')).toHaveTextContent('ark-el-title')
    expect(screen.getByLabelText('Selection surface')).toHaveTextContent('dark')
    expect(screen.getByLabelText('Selection identity')).toHaveTextContent(identityAfterSelect ?? '')
  })

  it('stores inline hover geometry, adaptive surfaces, and shortcut requests', async () => {
    await renderConnected(<EditorHarness sandboxOrigin={sandboxOrigin} />)
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

  it('replays an active preview when the listener is registered again', async () => {
    const firstListener = vi.fn()
    const secondListener = vi.fn()
    const { rerender } = await renderConnected(
      <EditorHarness sandboxOrigin={sandboxOrigin} transformPreviewListener={firstListener} />,
    )
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
    })

    expect(firstListener).toHaveBeenLastCalledWith(
      expect.objectContaining({ elementId: 'ark-el-title', geometry }),
    )

    rerender(
      <EditorHarness sandboxOrigin={sandboxOrigin} transformPreviewListener={secondListener} />,
    )

    expect(secondListener).toHaveBeenCalledWith(
      expect.objectContaining({ elementId: 'ark-el-title', geometry }),
    )
  })

  it('ignores a late transform commit for an element that is no longer selected', async () => {
    await renderConnected(<EditorHarness sandboxOrigin={sandboxOrigin} />)
    const iframeWindow = getIframeWindow()
    const geometry = { x: 0.1, y: 0.2, width: 0.5, height: 0.1 }

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
          data: createEditorGeometryMessage('ark-el-title', 0, geometry),
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
          data: createEditorTransformCommitMessage('ark-el-title', 0, geometry),
          origin: sandboxOrigin,
          source: iframeWindow,
        }),
      )
    })

    expect(screen.getByLabelText('Selection')).toHaveTextContent('ark-el-body')
    expect(screen.getByLabelText('Geometry')).toHaveTextContent('none')
    expect(screen.getByLabelText('Transform commit')).toHaveTextContent('none')
  })

  it('clears transform state when the runtime cancels a gesture', async () => {
    await renderConnected(<EditorHarness sandboxOrigin={sandboxOrigin} />)
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
    await renderConnected(
      <EditorHarness onSelectionChange={onSelectionChange} sandboxOrigin={sandboxOrigin} />,
    )
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
    const { rerender } = await renderConnected(
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

    testRuntimeMessages = []
    await waitForRuntimeConnection()
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
    await renderConnected(<EditorHarness sandboxOrigin={sandboxOrigin} />)
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
    const { rerender } = await renderConnected(
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
        iframeGenerationKey: currentTestFrameKey(),
        sessionHandshake: currentTestHandshake(),
      })

      return (
        <div>
          <iframe ref={iframeRef} title="Deck preview" />
          <TestEditorRuntimeConnection
            forwardPublicMessages
            iframeGenerationKey={currentTestFrameKey()}
            iframeRef={iframeRef}
            sandboxOrigin={sandboxOrigin}
            sessionHandshake={currentTestHandshake()}
          />
          <output aria-label="Text edit active">{bridge.textEditActive ? 'yes' : 'no'}</output>
        </div>
      )
    }

    render(<TextEditHarness />)
    await waitForRuntimeConnection()
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
    await renderConnected(
      <EditorHarness canPostToFrame={() => false} sandboxOrigin={sandboxOrigin} />,
    )
    const iframeWindow = getIframeWindow()
    const postMessage = vi.spyOn(iframeWindow, 'postMessage')

    await user.click(screen.getByRole('button', { name: 'Enable editor' }))

    expect(postMessage).not.toHaveBeenCalled()
  })

  it('ignores inbound editor messages when shouldAcceptInbound returns false', async () => {
    await renderConnected(
      <EditorHarness sandboxOrigin={sandboxOrigin} shouldAcceptInbound={() => false} />,
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

    expect(screen.getByLabelText('Editor ready')).toHaveTextContent('pending')
  })
})
