import { useId, useRef, useState, type ReactNode } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buttonVariants } from '@/components/ui/button-variants'
import { cn } from '@/lib/ui/utils'

export const inspectorFieldClassName =
  'h-6 w-full min-w-0 rounded-sm border border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar-active)] px-1.5 text-[11px] text-[var(--ark-titlebar-fg)] outline-none disabled:cursor-not-allowed disabled:opacity-50'

const sectionTitleClassName =
  'text-[10px] font-semibold uppercase tracking-wide text-[var(--ark-titlebar-muted)]'

export function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 className={sectionTitleClassName}>{title}</h3>
      {children}
    </section>
  )
}

export function InspectorRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="shrink-0 text-[var(--ark-titlebar-muted)]">{label}</span>
      <span className="min-w-0 truncate text-right text-[var(--ark-titlebar-fg)]">{children}</span>
    </div>
  )
}

type CommitNumberFieldProps = {
  label: string
  value: string
  disabled: boolean
  suffix: string
  onCommit: (raw: string) => void
}

/** Numeric input that commits on blur or Enter instead of every keystroke. */
export function CommitNumberField({
  label,
  value,
  disabled,
  suffix,
  onCommit,
}: CommitNumberFieldProps) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const draftRef = useRef<string | null>(null)

  const setDraftValue = (next: string | null) => {
    draftRef.current = next
    setDraft(next)
  }

  const commit = () => {
    const current = draftRef.current

    if (current !== null && current !== value) {
      onCommit(current)
    }

    setDraftValue(null)
  }

  return (
    <label className="flex min-w-0 items-center gap-1 text-[11px]" htmlFor={id}>
      <span className="w-3.5 shrink-0 text-[var(--ark-titlebar-muted)]">{label}</span>
      <span className="relative flex min-w-0 flex-1 items-center">
        <input
          aria-label={`${label} (${suffix})`}
          className={cn(inspectorFieldClassName, 'pr-6 text-right tabular-nums')}
          disabled={disabled}
          id={id}
          inputMode="decimal"
          onBlur={commit}
          onChange={(event) => setDraftValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setDraftValue(null)
              event.currentTarget.blur()
            }
          }}
          type="text"
          value={draft ?? value}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute right-1.5 text-[10px] text-[var(--ark-titlebar-muted)]"
        >
          {suffix}
        </span>
      </span>
    </label>
  )
}

type CommitTextFieldProps = {
  label: string
  value: string
  disabled: boolean
  placeholder?: string
  onCommit: (next: string) => void
}

/** Text input that commits on blur or Enter instead of every keystroke. */
export function CommitTextField({
  label,
  value,
  disabled,
  placeholder,
  onCommit,
}: CommitTextFieldProps) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const draftRef = useRef<string | null>(null)

  const setDraftValue = (next: string | null) => {
    draftRef.current = next
    setDraft(next)
  }

  const commit = () => {
    const current = draftRef.current

    if (current !== null && current !== value) {
      onCommit(current)
    }

    setDraftValue(null)
  }

  return (
    <label className="flex flex-col gap-1 text-[11px]" htmlFor={id}>
      <span className="text-[var(--ark-titlebar-muted)]">{label}</span>
      <input
        className={inspectorFieldClassName}
        disabled={disabled}
        id={id}
        onBlur={commit}
        onChange={(event) => setDraftValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setDraftValue(null)
            event.currentTarget.blur()
          }
        }}
        placeholder={placeholder}
        type="text"
        value={draft ?? value}
      />
    </label>
  )
}

type InspectorIconButtonProps = {
  active?: boolean
  children: ReactNode
  disabled: boolean
  label: string
  onClick: () => void
}

export function InspectorIconButton({
  active = false,
  children,
  disabled,
  label,
  onClick,
}: InspectorIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          aria-pressed={active}
          className={cn(
            buttonVariants({ size: 'icon-sm', variant: 'ghost' }),
            'size-6 shrink-0 rounded-sm border-0 text-[var(--ark-titlebar-fg)] shadow-none',
            'hover:bg-[var(--ark-titlebar-hover)]',
            'disabled:cursor-not-allowed disabled:text-[var(--ark-titlebar-muted)]/50',
            active && 'bg-[var(--ark-titlebar-active)] text-[var(--ark-accent)]',
          )}
          disabled={disabled}
          onClick={onClick}
          type="button"
        >
          <span aria-hidden className="inline-flex">
            {children}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
