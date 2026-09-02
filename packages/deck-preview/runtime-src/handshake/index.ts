import '../shared/constants.ts'

var handshake = C.HANDSHAKE
var targetOrigin = C.PARENT_ORIGIN
var editorSessionHandoffKey = C.EDITOR_SESSION_HANDOFF_KEY
var handshakeType = C.HANDSHAKE_TYPE
var protocolVersion = C.PROTOCOL_VERSION
var ownScript = document.currentScript
var parentWindow = window.parent
var safeParentPostMessage =
  parentWindow && parentWindow !== window && typeof parentWindow.postMessage === 'function'
    ? parentWindow.postMessage.bind(parentWindow)
    : null
var safeSetTimeout = window.setTimeout.bind(window)
var delays = [0, 0, 50, 200]
var attempt = 0

if (editorSessionHandoffKey) {
  try {
    Object.defineProperty(window, editorSessionHandoffKey, {
      configurable: true,
      value: handshake,
    })
  } catch {
    var handoffTarget = window as unknown as Record<string, string>
    handoffTarget[editorSessionHandoffKey] = handshake
  }
}

if (ownScript && ownScript.parentNode) {
  ownScript.parentNode.removeChild(ownScript)
}

function postHandshake() {
  try {
    if (safeParentPostMessage) {
      safeParentPostMessage(
        {
          type: handshakeType,
          handshake: handshake,
          protocolVersion: protocolVersion,
        },
        targetOrigin,
      )
    }
  } catch {
    /* ignore */
  }

  if (attempt >= delays.length - 1) {
    return
  }

  attempt += 1
  safeSetTimeout(postHandshake, delays[attempt])
}

postHandshake()
