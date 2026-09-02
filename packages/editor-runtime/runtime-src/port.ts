import './constants.ts'
import { handleShellMessage } from './lifecycle.ts'
import { runtime } from './state.ts'
import type { PortCandidate } from './types.ts'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function clampIndex(index: number, count: number) {
  if (!Number.isFinite(index) || count <= 0) {
    return 0
  }

  return Math.max(0, Math.min(count - 1, Math.floor(index)))
}

export function postToParent(message: unknown) {
  if (!runtime.activePortPostMessage) {
    return
  }

  runtime.activePortPostMessage(message)
}

export function closePortCandidate(candidate: PortCandidate) {
  try {
    candidate.close()
  } catch {
    /* ignore */
  }
}

export function acceptPortCandidate(candidate: PortCandidate) {
  if (runtime.activePortPostMessage) {
    closePortCandidate(candidate)
    return
  }

  runtime.activePortPostMessage = candidate.post

  runtime.pendingPortCandidates.forEach(function (pending) {
    if (pending !== candidate) {
      closePortCandidate(pending)
    }
  })
  runtime.pendingPortCandidates = [candidate]
}

export function createPortCandidate() {
  if (
    !runtime.sessionHandshake ||
    typeof runtime.SafeMessageChannel !== 'function' ||
    !runtime.safeParentPostMessage
  ) {
    return null
  }

  var channel = new runtime.SafeMessageChannel()
  var candidate = {
    port: channel.port1,
    remotePort: channel.port2,
    post: channel.port1.postMessage.bind(channel.port1),
    close: channel.port1.close.bind(channel.port1),
    accepted: false,
  }

  channel.port1.onmessage = function (event) {
    var data = event.data

    if (!candidate.accepted) {
      if (
        isRecord(data) &&
        data.type === C.CONNECT_ACK &&
        data.protocolVersion === C.PROTOCOL_VERSION
      ) {
        candidate.accepted = true
        acceptPortCandidate(candidate)
      }
      return
    }

    handleShellMessage(data)
  }
  runtime.pendingPortCandidates.push(candidate)
  return candidate
}

export function connectEditorPort(candidate: PortCandidate | null) {
  if (!candidate || runtime.activePortPostMessage || !runtime.safeParentPostMessage) {
    if (candidate) {
      closePortCandidate(candidate)
    }
    return
  }

  try {
    runtime.safeParentPostMessage(
      {
        type: C.CONNECT,
        handshake: runtime.sessionHandshake,
        protocolVersion: C.PROTOCOL_VERSION,
      },
      C.PARENT_ORIGIN || '*',
      [candidate.remotePort],
    )
  } catch {
    closePortCandidate(candidate)
  }
}

export function startPortConnection() {
  if (runtime.sessionHandshake) {
    var connectDelays = [0, 50, 200, 1000]
    var connectCandidates = connectDelays.map(function () {
      return createPortCandidate()
    })

    connectEditorPort(connectCandidates[0])
    connectDelays.slice(1).forEach(function (delay, index) {
      runtime.safeSetTimeout(function () {
        connectEditorPort(connectCandidates[index + 1])
      }, delay)
    })
  }
}

export function postError(message: unknown, code?: string) {
  postToParent({
    type: C.ERROR,
    message: String(message),
    code: code || undefined,
  })
}
