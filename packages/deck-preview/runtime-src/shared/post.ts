import './constants.ts'

export function postToParent(message: unknown) {
  // Always post: thumbnail Electron loads the deck top-level, so parent ===
  // window and the settle script listens for self-posted READY/CHANGE.
  window.parent.postMessage(message, C.PARENT_ORIGIN || '*')
}

export function postRuntimeError(message: unknown, source?: string) {
  postToParent({
    type: C.ERROR,
    message: String(message),
    source: source || undefined,
  })
}

export function installErrorListeners() {
  window.addEventListener('error', function (event) {
    var errorEvent = event as ErrorEvent
    var message = (errorEvent && errorEvent.message) || 'Deck runtime error'
    var source = errorEvent && errorEvent.filename ? String(errorEvent.filename) : 'window.error'
    postRuntimeError(message, source)
  })

  window.addEventListener('unhandledrejection', function (event) {
    var reason = (event as PromiseRejectionEvent).reason as { message?: unknown } | undefined
    var message = reason && reason.message ? String(reason.message) : String(reason)
    postRuntimeError(message, 'window.unhandledrejection')
  })
}
