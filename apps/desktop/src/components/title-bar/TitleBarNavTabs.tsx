import { Link } from 'react-router'

import { cn } from '@/lib/ui/utils'

import type { AppTitleBarNav } from './title-bar-types'

function navTabClassName(active: boolean) {
  return cn(
    'inline-flex h-7 items-center rounded-sm px-2.5 text-xs font-medium outline-none',
    'focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? 'bg-[var(--ark-titlebar-hover)] text-[var(--ark-titlebar-fg)]'
      : 'text-[var(--ark-titlebar-muted)] hover:text-[var(--ark-titlebar-fg)]',
  )
}

export function TitleBarNavTabs({
  disabled,
  navActive,
  onNew,
}: {
  disabled?: boolean
  navActive: AppTitleBarNav
  onNew: () => void
}) {
  return (
    <nav aria-label="Workspace" className="flex shrink-0 items-center gap-0.5">
      {navActive === 'new' ? (
        <span aria-current="page" className={navTabClassName(true)}>
          New
        </span>
      ) : (
        <button
          className={navTabClassName(false)}
          disabled={disabled}
          onClick={onNew}
          type="button"
        >
          New
        </button>
      )}
      <Link
        aria-current={navActive === 'slides' ? 'page' : undefined}
        className={navTabClassName(navActive === 'slides')}
        to="/decks"
      >
        Slides
      </Link>
    </nav>
  )
}
