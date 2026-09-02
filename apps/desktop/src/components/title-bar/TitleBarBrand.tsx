import { Link } from 'react-router'
import { PresentationIcon } from 'lucide-react'

export function TitleBarBrand() {
  return (
    <Link
      className="flex min-w-0 items-center gap-2 rounded-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      to="/decks"
    >
      <PresentationIcon aria-hidden className="size-4 shrink-0 text-[var(--ark-focus)]" />
      <span className="truncate font-heading text-[15px] font-semibold leading-none tracking-tight">
        Ark
      </span>
    </Link>
  )
}
