export const CHAT_PANEL_MIN_WIDTH_PX = 320
export const CHAT_PANEL_DEFAULT_PERCENT = 30

export function getChatPanelDefaultSize(_containerWidth: number) {
  return CHAT_PANEL_MIN_WIDTH_PX
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
