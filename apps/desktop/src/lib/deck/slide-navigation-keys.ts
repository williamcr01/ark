const PREVIEW_NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
const PRESENT_NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown', ' ', 'Spacebar', 'Enter', 'PageDown'])
const PRESENT_PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'Backspace', 'PageUp'])

export function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  const tag = target.tagName

  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true
  }

  return Boolean(target.closest('[contenteditable="true"], [role="textbox"]'))
}

export function isActivatableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(target.closest('button, a[href], [role="button"]'))
}

export function clampSlideIndex(index: number, slideCount: number) {
  if (!Number.isFinite(index) || slideCount <= 0) {
    return 0
  }

  return Math.max(0, Math.min(slideCount - 1, Math.floor(index)))
}

export function getPreviewKeyboardTargetIndex(
  key: string,
  currentIndex: number,
  slideCount: number,
) {
  if (!PREVIEW_NAV_KEYS.has(key)) {
    return null
  }

  const delta = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1

  return clampSlideIndex(currentIndex + delta, slideCount)
}

export function getPresentKeyboardTargetIndex(
  key: string,
  currentIndex: number,
  slideCount: number,
) {
  if (PRESENT_NEXT_KEYS.has(key)) {
    return clampSlideIndex(currentIndex + 1, slideCount)
  }

  if (PRESENT_PREV_KEYS.has(key)) {
    return clampSlideIndex(currentIndex - 1, slideCount)
  }

  if (key === 'Home') {
    return 0
  }

  if (key === 'End') {
    return clampSlideIndex(slideCount - 1, slideCount)
  }

  return null
}
