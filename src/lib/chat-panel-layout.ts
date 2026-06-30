export const CHAT_PANEL_MIN_WIDTH_PX = 280
export const CHAT_PANEL_DEFAULT_PERCENT = 20

export function getChatPanelDefaultSize(containerWidth: number) {
  if (containerWidth <= 0) {
    return `${CHAT_PANEL_DEFAULT_PERCENT}%`
  }

  const percentWidth = containerWidth * (CHAT_PANEL_DEFAULT_PERCENT / 100)

  if (percentWidth < CHAT_PANEL_MIN_WIDTH_PX) {
    return CHAT_PANEL_MIN_WIDTH_PX
  }

  return `${CHAT_PANEL_DEFAULT_PERCENT}%`
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
