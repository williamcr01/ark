/** Injected constants, plus the port and state variables every later chunk closes over. */
export function preambleChunk(constantsJson: string) {
  return `(function () {
  var C = ${constantsJson};
  var ownScript = document.currentScript;
  var sessionHandshake =
    typeof window[C.SESSION_HANDOFF_KEY] === 'string' ? window[C.SESSION_HANDOFF_KEY] : '';

  try {
    delete window[C.SESSION_HANDOFF_KEY];
  } catch (error) {}

  // Do not leave the per-preview capability in DOM-visible script text.
  if (ownScript && ownScript.parentNode) {
    ownScript.parentNode.removeChild(ownScript);
  }

  var parentWindow = window.parent;
  var safeParentPostMessage =
    parentWindow !== window && typeof parentWindow.postMessage === 'function'
      ? parentWindow.postMessage.bind(parentWindow)
      : null;
  var SafeMessageChannel = window.MessageChannel;
  var safeSetTimeout = window.setTimeout.bind(window);
  var activePortPostMessage = null;
  var pendingPortCandidates = [];
  var enabled = false;
  var currentTool = 'select';
  var currentSlideIndex = 0;
  var selectedElement = null;
  var selectedElements = [];
  var textEditElement = null;
  var originalTextBeforeEdit = null;
  var listenersBound = false;
  var transformState = null;
  var editorScale = 1;
  var marqueeElement = null;
  var resizeHandles = [];
  var guideElements = [];
  var hoveredElement = null;
  var editorStyle = null;
  var nudgeState = null;
  var hoverRafId = 0;
  var pendingHover = null;
`
}
