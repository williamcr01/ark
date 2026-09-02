export type AppTitleBarVariant = 'home' | 'library' | 'editor'
export type AppTitleBarNav = 'new' | 'slides' | null

export function defaultNavActive(variant: AppTitleBarVariant): AppTitleBarNav {
  if (variant === 'library') return 'slides'
  if (variant === 'home') return 'new'
  return null
}
