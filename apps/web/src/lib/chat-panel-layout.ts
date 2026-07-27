export const CHAT_PANEL_MIN_WIDTH_PX = 320
export const CHAT_PANEL_MAX_WIDTH_PX = 460
export const CHAT_PANEL_TARGET_WIDTH_PX = 380
export const CHAT_PANEL_DEFAULT_PERCENT = 30

export function getChatPanelDefaultSize(containerWidth: number) {
  if (containerWidth <= 0) {
    return `${CHAT_PANEL_DEFAULT_PERCENT}%`
  }

  return Math.min(
    CHAT_PANEL_MAX_WIDTH_PX,
    Math.max(CHAT_PANEL_MIN_WIDTH_PX, Math.min(CHAT_PANEL_TARGET_WIDTH_PX, containerWidth * 0.45)),
  )
}

export function getDeckPanelDefaultSizeWithChat(
  containerWidth: number,
  chatDefaultSize: number | string,
) {
  if (typeof chatDefaultSize === 'number') {
    if (containerWidth <= 0) {
      return `${100 - CHAT_PANEL_DEFAULT_PERCENT}%`
    }

    return containerWidth - chatDefaultSize
  }

  return `${100 - CHAT_PANEL_DEFAULT_PERCENT}%`
}
