import './constants.ts'
import type {
  EditorTool,
  NudgeState,
  PendingHover,
  PortCandidate,
  TransformState,
} from './types.ts'

const handshakeValue = (window as unknown as Record<string, unknown>)[C.SESSION_HANDOFF_KEY]

export const runtime = {
  ownScript: document.currentScript,
  sessionHandshake: typeof handshakeValue === 'string' ? handshakeValue : '',
  parentWindow: window.parent,
  safeParentPostMessage:
    window.parent !== window && typeof window.parent.postMessage === 'function'
      ? window.parent.postMessage.bind(window.parent)
      : null,
  SafeMessageChannel: window.MessageChannel,
  safeSetTimeout: window.setTimeout.bind(window),
  activePortPostMessage: null as ((message: unknown) => void) | null,
  pendingPortCandidates: [] as PortCandidate[],
  enabled: false,
  currentTool: 'select' as EditorTool,
  currentSlideIndex: 0,
  selectedElement: null as HTMLElement | null,
  selectedElements: [] as HTMLElement[],
  textEditElement: null as HTMLElement | null,
  originalTextBeforeEdit: null as string | null,
  listenersBound: false,
  transformState: null as TransformState | null,
  editorScale: 1,
  marqueeElement: null as HTMLElement | null,
  resizeHandles: [] as HTMLElement[],
  guideElements: [] as Array<HTMLElement | undefined>,
  hoveredElement: null as HTMLElement | null,
  editorStyle: null as HTMLStyleElement | null,
  nudgeState: null as NudgeState | null,
  hoverRafId: 0,
  pendingHover: null as PendingHover | null,
}

try {
  delete (window as unknown as Record<string, unknown>)[C.SESSION_HANDOFF_KEY]
} catch {
  /* ignore */
}

if (runtime.ownScript && runtime.ownScript.parentNode) {
  runtime.ownScript.parentNode.removeChild(runtime.ownScript)
}
