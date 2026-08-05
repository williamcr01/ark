import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ProviderLogo } from '@/components/ProviderLogo'
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
  MorphMenuWing,
  morphMenuSurfaceClassName,
  morphMenuTriggerClassName,
} from '@/components/ui/morph-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { useAnimatedHeight } from '@/hooks/useAnimatedHeight'
import {
  formatModelName,
  formatProviderLabel,
  formatUnavailableBadge,
  type AvailableModel,
} from '@/hooks/useAvailableModels'
import { formatReasoningEffortLabel, type ReasoningEffort } from '@/hooks/useReasoningEffort'
import { useSequencedPresence } from '@/hooks/useSequencedPresence'
import { cn } from '@/lib/utils'
import type { ProviderId } from '@ark/contracts'

function ModelSelectorTriggerLabel({
  modelName,
  effortLabel,
}: {
  modelName: string
  effortLabel?: string
}) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [hideEffort, setHideEffort] = useState(false)
  const fullLabel = effortLabel ? `${modelName} · ${effortLabel}` : modelName

  useLayoutEffect(() => {
    const container = containerRef.current
    const measure = measureRef.current
    if (!container || !measure || !effortLabel) {
      setHideEffort(false)
      return
    }

    const update = () => {
      const available = container.clientWidth
      if (available <= 0) {
        setHideEffort(false)
        return
      }
      setHideEffort(measure.scrollWidth > available)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [effortLabel, modelName])

  return (
    <span className="relative min-w-0 shrink overflow-hidden text-left" ref={containerRef}>
      <span aria-hidden className="invisible absolute whitespace-nowrap" ref={measureRef}>
        {fullLabel}
      </span>
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate">{modelName}</span>
        {effortLabel && !hideEffort ? <span className="shrink-0">· {effortLabel}</span> : null}
      </span>
    </span>
  )
}

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
  // a detached submenu, so the two read as one surface. Its anchor is the
  // vertical centre of the clicked row relative to the panel.
  const effortWing = useSequencedPresence<{ model: AvailableModel; anchor: number }>()
  const panelRef = useRef<HTMLDivElement>(null)
  const effortModel = effortWing.active?.model ?? null
  const effortAnchor = effortWing.active?.anchor ?? 0

  const selected = models.find((model) => model.id === value)
  const normalizedQuery = query.trim().toLowerCase()

  const groups = useMemo(() => {
    const filtered = models.filter((model) => modelMatchesQuery(model, normalizedQuery))
    return groupModelsByProvider(filtered)
  }, [models, normalizedQuery])
  const capturePanelHeight = useAnimatedHeight(panelRef, groups)

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

  const selectedName = selected ? formatModelName(selected) : 'Select model'
  const effortLabel =
    selected && reasoningEffort ? formatReasoningEffortLabel(reasoningEffort) : undefined
  const triggerLabel = isLoading
    ? 'Loading models…'
    : effortLabel
      ? `${selectedName} · ${effortLabel}`
      : selectedName

  const closeMenu = () => {
    setOpen(false)
    setQuery('')
    effortWing.reset()
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
      effortWing.hide()
      return
    }

    const rowRect = row.getBoundingClientRect()
    const panel = panelRef.current?.getBoundingClientRect()
    const nextAnchor = panel ? rowRect.top + rowRect.height / 2 - panel.top : effortAnchor
    effortWing.show({ model, anchor: nextAnchor })
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
            // Sized to its contents rather than the tools row: `grow` stretched the
            // trigger across the free space and `justify-between` then pushed the
            // chevron out to the far edge. The max-widths stay as truncation caps.
            'h-8 min-w-0 max-w-full shrink justify-start rounded-md font-medium text-[var(--ark-ink)] sm:max-w-[260px]',
            'motion-reduce:transition-none',
            !canGenerate && 'text-muted-foreground',
            className,
          )}
          disabled={disabled || isLoading}
          size="sm"
          title={isLoading ? undefined : triggerLabel}
          type="button"
          variant="ghost"
        >
          {isLoading ? (
            <Skeleton className="h-3.5 w-24" />
          ) : (
            <>
              {selected ? <ProviderLogo className="size-4" provider={selected.provider} /> : null}
              <ModelSelectorTriggerLabel effortLabel={effortLabel} modelName={selectedName} />
            </>
          )}
          <ChevronsUpDownIcon className="opacity-50" data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      {/* Radius matches the trigger's `rounded-md` so the panel grows out of its
          actual corners; the default assumes the pill shape the trigger no longer has. */}
      <MorphMenuContent bare className="relative" triggerRadius={8}>
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
                  capturePanelHeight()
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
                    <DropdownMenuLabel className="flex items-center gap-2 text-[var(--ark-muted-ink)]">
                      <ProviderLogo className="size-4" provider={group.provider} />
                      <span>
                        {group.label} · {group.readyCount} ready
                      </span>
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
          <MorphMenuWing
            anchorY={effortAnchor}
            className="w-[7.5rem]"
            containerRef={panelRef}
            data-model-id={effortModel.id}
            key={effortModel.id}
            onExitComplete={effortWing.completeExit}
            state={effortWing.state}
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
          </MorphMenuWing>
        ) : null}
      </MorphMenuContent>
    </DropdownMenu>
  )
}
