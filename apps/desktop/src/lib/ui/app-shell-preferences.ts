/** Small pieces of app-shell state that live outside React: the deep-link slide index
 *  and the remembered chat-panel open state. */

/** Parse `?slide=` — 0-based index (slide=0 is the first slide). */
export function parseInitialSlideIndex(value: string | null) {
  if (!value) {
    return 0
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

const CHAT_OPEN_PREFERENCE_KEY = 'ark:chat-open'

export function loadChatOpenPreference(): boolean | null {
  try {
    const value = window.localStorage.getItem(CHAT_OPEN_PREFERENCE_KEY)
    if (value === '1') return true
    if (value === '0') return false
    return null
  } catch {
    return null
  }
}

/** The titlebar chat toggle sits outside the drawer, so its own pointer/focus events
 *  would dismiss the drawer, and the click that follows would then reopen it. Treat
 *  events originating from that button as if they happened inside the drawer. */
export function isChatPanelToggleTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[aria-controls="ark-chat-panel"]') !== null
}

export function storeChatOpenPreference(open: boolean) {
  try {
    window.localStorage.setItem(CHAT_OPEN_PREFERENCE_KEY, open ? '1' : '0')
  } catch {
    // Storage can be unavailable (e.g. private browsing); the preference just won't persist.
  }
}
