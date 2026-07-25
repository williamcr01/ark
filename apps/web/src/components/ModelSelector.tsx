import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  MorphMenuContent,
  MorphMenuFooter,
  morphMenuSurfaceClassName,
  morphMenuTriggerClassName,
} from '@/components/ui/morph-menu'
import { Skeleton } from '@/components/ui/skeleton'
import {
  formatModelName,
  formatProviderLabel,
  formatUnavailableBadge,
  type AvailableModel,
} from '@/hooks/useAvailableModels'
import { formatReasoningEffortLabel, type ReasoningEffort } from '@/hooks/useReasoningEffort'
import { cn } from '@/lib/utils'
import type { ProviderId } from '@ark/contracts'

const PROVIDER_ORDER: ProviderId[] = ['openai', 'anthropic', 'google']

const groupModelsByProvider = (models: AvailableModel[]) => {
  const groups = new Map<ProviderId, AvailableModel[]>()

  for (const provider of PROVIDER_ORDER) {
    groups.set(provider, [])
  }

  for (const model of models) {
    const list = groups.get(model.provider)
    if (list) {
      list.push(model)
    } else {
      groups.set(model.provider, [model])
    }
  }

  return PROVIDER_ORDER.filter((provider) => (groups.get(provider)?.length ?? 0) > 0).map(
    (provider) => {
      const providerModels = groups.get(provider) ?? []
      return {
        provider,
        label: formatProviderLabel(provider),
        models: providerModels,
        readyCount: providerModels.filter((model) => model.available).length,
      }
    },
  )
}

const modelMatchesQuery = (model: AvailableModel, query: string) => {
  if (!query) {
    return true
  }

  const haystack =
    `${formatProviderLabel(model.provider)} ${formatModelName(model)} ${model.modelId} ${model.id}`.toLowerCase()
  return haystack.includes(query)
}

export type ModelSelectorProps = {
  models: AvailableModel[]
  value: string
  reasoningEffort?: ReasoningEffort
  getReasoningEffort?: (modelId: string) => ReasoningEffort | undefined
  onSelect: (modelId: string, reasoningEffort?: ReasoningEffort) => void
  disabled?: boolean
  isLoading?: boolean
  canGenerate?: boolean
  className?: string
}

export function ModelSelector({
  models,
  value,
  reasoningEffort,
  getReasoningEffort,
  onSelect,
  disabled = false,
  isLoading = false,
  canGenerate = true,
  className,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Thinking effort grows out of the side of the model panel rather than opening
  // a detached submenu, so the two read as one surface. `effortAnchor` is the
  // vertical centre of the clicked row (relative to the panel) and `effortTop`
  // is that centre clamped so the wing can't hang off either end of the panel.
  const [effortModel, setEffortModel] = useState<AvailableModel | null>(null)
  const [effortAnchor, setEffortAnchor] = useState(0)
  const [effortClosing, setEffortClosing] = useState(false)
  const effortCloseTimerRef = useRef<number | null>(null)
  const pendingEffortRef = useRef<{ model: AvailableModel; anchor: number } | null>(null)
  const panelResizeFromRef = useRef<number | null>(null)
  const panelResizeAnimationRef = useRef<Animation | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const finishEffortClose = useCallback(() => {
    if (effortCloseTimerRef.current !== null) {
      window.clearTimeout(effortCloseTimerRef.current)
      effortCloseTimerRef.current = null
    }
    const pendingEffort = pendingEffortRef.current
    pendingEffortRef.current = null
    setEffortClosing(false)
    if (pendingEffort) {
      setEffortAnchor(pendingEffort.anchor)
      setEffortModel(pendingEffort.model)
    } else {
      setEffortModel(null)
    }
  }, [])

  const closeEffortWing = useCallback(() => {
    if (!effortModel || effortClosing) {
      return
    }
    setEffortClosing(true)
    effortCloseTimerRef.current = window.setTimeout(finishEffortClose, 200)
  }, [effortClosing, effortModel, finishEffortClose])

  useEffect(
    () => () => {
      if (effortCloseTimerRef.current !== null) {
        window.clearTimeout(effortCloseTimerRef.current)
      }
    },
    [],
  )

  // Positions the wing on attach rather than from an effect: its height is only
  // known once mounted, and this keeps the clamp out of React state.
  const placeWing = useCallback(
    (wing: HTMLDivElement | null) => {
      const panel = panelRef.current
      if (!wing || !panel) {
        return
      }

      const half = wing.offsetHeight / 2
      const top = Math.min(Math.max(effortAnchor, half), panel.offsetHeight - half)
      wing.style.top = `${top}px`
    },
    [effortAnchor],
  )

  const selected = models.find((model) => model.id === value)
  const normalizedQuery = query.trim().toLowerCase()

  const groups = useMemo(() => {
    const filtered = models.filter((model) => modelMatchesQuery(model, normalizedQuery))
    return groupModelsByProvider(filtered)
  }, [models, normalizedQuery])

  useLayoutEffect(() => {
    const panel = panelRef.current
    const fromHeight = panelResizeFromRef.current
    panelResizeFromRef.current = null
    panelResizeAnimationRef.current?.cancel()
    panelResizeAnimationRef.current = null

    if (!panel || fromHeight === null) {
      return
    }

    const toHeight = panel.getBoundingClientRect().height
    if (
      Math.abs(toHeight - fromHeight) < 1 ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return
    }

    const easing =
      getComputedStyle(panel).getPropertyValue('--ark-spring-ease').trim() ||
      'cubic-bezier(0.32, 0.72, 0, 1)'
    const animation = panel.animate([{ height: `${fromHeight}px` }, { height: `${toHeight}px` }], {
      duration: 280,
      easing,
    })
    panelResizeAnimationRef.current = animation
    animation.onfinish = () => {
      if (panelResizeAnimationRef.current === animation) {
        panelResizeAnimationRef.current = null
      }
    }

    return () => animation.cancel()
  }, [groups])

  const resolveModelEffort = (model: AvailableModel) => {
    const supported = model.reasoningEfforts ?? []
    const remembered = getReasoningEffort?.(model.id)
    if (remembered && supported.includes(remembered)) {
      return remembered
    }
    if (model.id === value && reasoningEffort && supported.includes(reasoningEffort)) {
      return reasoningEffort
    }
    if (model.defaultReasoningEffort && supported.includes(model.defaultReasoningEffort)) {
      return model.defaultReasoningEffort
    }
    return supported[0]
  }

  const triggerLabel = isLoading
    ? 'Loading models…'
    : selected
      ? reasoningEffort
        ? `${formatModelName(selected)} · ${formatReasoningEffortLabel(reasoningEffort)}`
        : formatModelName(selected)
      : 'Select model'

  const closeMenu = () => {
    if (effortCloseTimerRef.current !== null) {
      window.clearTimeout(effortCloseTimerRef.current)
      effortCloseTimerRef.current = null
    }
    setOpen(false)
    setQuery('')
    pendingEffortRef.current = null
    setEffortModel(null)
    setEffortClosing(false)
  }

  const selectModel = (model: AvailableModel, effort?: ReasoningEffort) => {
    if (!model.available) {
      return
    }

    const supported = model.reasoningEfforts ?? []
    if (supported.length === 0) {
      onSelect(model.id)
      closeMenu()
      return
    }

    const nextEffort = effort && supported.includes(effort) ? effort : resolveModelEffort(model)

    onSelect(model.id, nextEffort)
    closeMenu()
  }

  const toggleEffortEditor = (model: AvailableModel, row: HTMLElement) => {
    if (effortModel?.id === model.id) {
      pendingEffortRef.current = null
      closeEffortWing()
      return
    }

    const rowRect = row.getBoundingClientRect()
    const panel = panelRef.current?.getBoundingClientRect()
    const nextAnchor = panel ? rowRect.top + rowRect.height / 2 - panel.top : effortAnchor
    if (effortModel) {
      pendingEffortRef.current = { model, anchor: nextAnchor }
      closeEffortWing()
      return
    }

    setEffortAnchor(nextAnchor)
    setEffortClosing(false)
    setEffortModel(model)
  }

  return (
    <DropdownMenu
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeMenu()
          return
        }
        setOpen(true)
      }}
      open={open}
    >
      <DropdownMenuTrigger asChild>
        <Button
          aria-expanded={open}
          aria-label="Select model"
          className={cn(
            morphMenuTriggerClassName,
            'h-8 max-w-[260px] justify-between font-medium text-[var(--ark-ink)]',
            'motion-reduce:transition-none',
            !canGenerate && 'text-muted-foreground',
            className,
          )}
          disabled={disabled || isLoading}
          size="sm"
          type="button"
          variant="ghost"
        >
          {isLoading ? (
            <Skeleton className="h-3.5 w-24" />
          ) : (
            <span className="truncate">{triggerLabel}</span>
          )}
          <ChevronsUpDownIcon className="opacity-50" data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <MorphMenuContent bare className="relative">
        <div
          className={cn(
            'ark-control-panel! relative z-10 flex w-60 shrink-0 flex-col overflow-hidden rounded-lg bg-clip-padding',
            morphMenuSurfaceClassName,
          )}
          ref={panelRef}
        >
          <div className="ark-morph-reveal flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 px-2.5 py-2">
              <SearchIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                aria-label="Search models"
                className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                onChange={(event) => {
                  panelResizeFromRef.current =
                    panelRef.current?.getBoundingClientRect().height ?? null
                  setQuery(event.currentTarget.value)
                }}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="Search models…"
                value={query}
              />
            </div>

            <div className="ark-scrollbar-none max-h-64 min-h-0 flex-1 overflow-y-auto p-1">
              {groups.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                  {models.length === 0 ? 'No models available.' : 'No models match your search.'}
                </div>
              ) : (
                groups.map((group, groupIndex) => (
                  <div key={group.provider}>
                    {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuLabel className="text-[var(--ark-muted-ink)]">
                      {group.label} · {group.readyCount} ready
                    </DropdownMenuLabel>
                    <DropdownMenuGroup>
                      {group.models.map((model) => {
                        const unavailableLabel = formatUnavailableBadge(model)
                        const isSelected = model.id === value
                        const supportsEffort = (model.reasoningEfforts ?? []).length > 0
                        const canEditEffort = model.available && supportsEffort
                        const modelEffort = resolveModelEffort(model)
                        const isExpanded = effortModel?.id === model.id

                        return (
                          <div className="relative" data-model-row key={model.id}>
                            <DropdownMenuItem
                              className={cn(
                                'gap-2 py-1.5',
                                canEditEffort && 'pr-10',
                                !model.available && 'opacity-60',
                                isExpanded && 'bg-accent text-accent-foreground',
                              )}
                              disabled={!model.available}
                              onSelect={() => selectModel(model)}
                            >
                              <span className="min-w-0 truncate font-medium text-[var(--ark-ink)]">
                                {formatModelName(model)}
                              </span>
                              {modelEffort ? (
                                <span className="shrink-0 text-xs font-normal text-[var(--ark-muted-ink)] opacity-75">
                                  {formatReasoningEffortLabel(modelEffort)}
                                </span>
                              ) : null}
                              {unavailableLabel ? (
                                <span className="shrink-0 rounded-md bg-[var(--ark-accent-soft)] px-1.5 py-0.5 text-[0.65rem] text-[var(--ark-muted-ink)]">
                                  {unavailableLabel}
                                </span>
                              ) : null}
                              {isSelected ? (
                                <CheckIcon aria-hidden className="size-3.5 shrink-0" />
                              ) : null}
                            </DropdownMenuItem>
                            {canEditEffort ? (
                              <DropdownMenuItem
                                aria-label={`Edit thinking effort for ${formatModelName(model)}`}
                                className={cn(
                                  'absolute top-1/2 right-1 h-5 -translate-y-1/2 px-1.5 py-0 text-[0.625rem] font-medium text-[var(--ark-muted-ink)] opacity-65',
                                  isExpanded && 'bg-accent text-accent-foreground opacity-100',
                                )}
                                onSelect={(event) => {
                                  event.preventDefault()
                                  const row = (
                                    event.currentTarget as HTMLElement | null
                                  )?.closest<HTMLElement>('[data-model-row]')
                                  if (row) {
                                    toggleEffortEditor(model, row)
                                  }
                                }}
                              >
                                Edit
                              </DropdownMenuItem>
                            ) : null}
                          </div>
                        )
                      })}
                    </DropdownMenuGroup>
                  </div>
                ))
              )}
            </div>
          </div>

          <MorphMenuFooter
            className="justify-between"
            label="Collapse model picker"
            onCollapse={closeMenu}
          >
            <span className="truncate">{triggerLabel}</span>
            <ChevronsUpDownIcon aria-hidden className="size-4 shrink-0 opacity-50" />
          </MorphMenuFooter>
        </div>

        {/* Sits flush against the panel's right edge, centred on the clicked row,
            and only as tall as the effort list needs. */}
        {effortModel ? (
          <div
            className="ark-control-wing! ark-morph-wing absolute left-full z-20 -ml-px flex max-h-64 w-[7.5rem] -translate-y-1/2 flex-col overflow-hidden rounded-r-lg bg-clip-padding"
            data-model-id={effortModel.id}
            data-state={effortClosing ? 'closed' : 'open'}
            key={effortModel.id}
            onAnimationEnd={(event) => {
              if (effortClosing && event.target === event.currentTarget) {
                finishEffortClose()
              }
            }}
            ref={placeWing}
            style={{ top: effortAnchor }}
          >
            <div className="ark-wing-reveal shrink-0 truncate px-2.5 pt-2 text-xs font-medium text-[var(--ark-muted-ink)]">
              Thinking effort
            </div>
            <div className="ark-scrollbar-none ark-wing-reveal min-h-0 flex-1 overflow-y-auto p-1">
              {(effortModel.reasoningEfforts ?? []).map((effort) => (
                <DropdownMenuItem key={effort} onSelect={() => selectModel(effortModel, effort)}>
                  <span className="flex-1 truncate">{formatReasoningEffortLabel(effort)}</span>
                  {resolveModelEffort(effortModel) === effort ? (
                    <CheckIcon aria-hidden className="size-4 shrink-0" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </div>
          </div>
        ) : null}
      </MorphMenuContent>
    </DropdownMenu>
  )
}
