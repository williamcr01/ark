import type { DashboardFileActions } from '@/hooks/useDashboardFileActions'

import { DashboardTitleBar } from './title-bar/DashboardTitleBar'
import { EditorTitleBar } from './title-bar/EditorTitleBar'
import {
  defaultNavActive,
  type AppTitleBarNav,
  type AppTitleBarVariant,
} from './title-bar/title-bar-types'

export type { AppTitleBarNav, AppTitleBarVariant }

export type AppTitleBarProps = {
  fileActions?: DashboardFileActions
  navActive?: AppTitleBarNav
  onToggleChat?: () => void
  variant?: AppTitleBarVariant
}

export function AppTitleBar({
  fileActions,
  navActive,
  onToggleChat,
  variant = 'editor',
}: AppTitleBarProps) {
  const resolvedNav = navActive ?? defaultNavActive(variant)

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-[var(--ark-panel-raised)] px-3 text-foreground">
      {variant === 'editor' ? (
        <EditorTitleBar navActive={resolvedNav} onToggleChat={onToggleChat} />
      ) : (
        <DashboardTitleBar fileActions={fileActions} navActive={resolvedNav} variant={variant} />
      )}
    </header>
  )
}
