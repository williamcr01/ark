import { useMemo, useState } from 'react'
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  SearchIcon,
} from 'lucide-react'

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
  onSelect,
  disabled = false,
  isLoading = false,
  canGenerate = true,
  className,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Drilling into a model's thinking effort swaps the panel contents in place
  // rather than opening a detached submenu, so the morph stays a single surface.
  const [effortModel, setEffortModel] = useState<AvailableModel | null>(null)

  const selected = models.find((model) => model.id === value)
  const normalizedQuery = query.trim().toLowerCase()

  const groups = useMemo(() => {
    const filtered = models.filter((model) => modelMatchesQuery(model, normalizedQuery))
    return groupModelsByProvider(filtered)
  }, [models, normalizedQuery])

  const triggerLabel = isLoading
    ? 'Loading models…'
    : selected
      ? reasoningEffort
        ? `${formatModelName(selected)} · ${formatReasoningEffortLabel(reasoningEffort)}`
        : formatModelName(selected)
      : 'Select model'

  const closeMenu = () => {
    setOpen(false)
    setQuery('')
    setEffortModel(null)
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

    const nextEffort =
      effort && supported.includes(effort)
        ? effort
        : model.id === value && reasoningEffort && supported.includes(reasoningEffort)
          ? reasoningEffort
          : (model.defaultReasoningEffort ?? supported[0])

    onSelect(model.id, nextEffort)
    closeMenu()
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
      <MorphMenuContent className="w-64">
        {effortModel ? (
          <div
            className="flex min-h-0 flex-1 flex-col animate-in fade-in-0 slide-in-from-right-2 motion-reduce:animate-none"
            key={`effort:${effortModel.id}`}
          >
            <div className="shrink-0 border-b border-[var(--ark-control-border)] px-2.5 py-2 text-sm font-medium">
              <span className="truncate">{formatModelName(effortModel)}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              <DropdownMenuItem
                className="text-[var(--ark-muted-ink)]"
                onSelect={(event) => {
                  event.preventDefault()
                  setEffortModel(null)
                }}
              >
                <ChevronLeftIcon aria-hidden className="size-4 shrink-0" />
                All models
              </DropdownMenuItem>
              <DropdownMenuLabel className="text-[var(--ark-muted-ink)]">
                Thinking effort
              </DropdownMenuLabel>
              {(effortModel.reasoningEfforts ?? []).map((effort) => (
                <DropdownMenuItem key={effort} onSelect={() => selectModel(effortModel, effort)}>
                  <span className="flex-1">{formatReasoningEffortLabel(effort)}</span>
                  {effortModel.id === value && reasoningEffort === effort ? (
                    <CheckIcon aria-hidden className="size-4 shrink-0" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </div>
          </div>
        ) : (
          <div
            className="flex min-h-0 flex-1 flex-col animate-in fade-in-0 slide-in-from-left-2 motion-reduce:animate-none"
            key="models"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--ark-control-border)] px-2.5 py-2">
              <SearchIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                aria-label="Search models"
                className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                onChange={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="Search models…"
                value={query}
              />
            </div>

            <div className="max-h-64 min-h-0 flex-1 overflow-y-auto p-1">
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

                        return (
                          <DropdownMenuItem
                            className={cn('gap-2 py-1.5', !model.available && 'opacity-60')}
                            disabled={!model.available}
                            key={model.id}
                            onSelect={(event) => {
                              if (!supportsEffort) {
                                selectModel(model)
                                return
                              }
                              event.preventDefault()
                              setEffortModel(model)
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate font-medium text-[var(--ark-ink)]">
                              {formatModelName(model)}
                            </span>
                            {unavailableLabel ? (
                              <span className="shrink-0 rounded-md border border-[var(--ark-control-border)] px-1.5 py-0.5 text-[0.65rem] text-[var(--ark-muted-ink)]">
                                {unavailableLabel}
                              </span>
                            ) : null}
                            {isSelected ? (
                              <CheckIcon aria-hidden className="size-4 shrink-0" />
                            ) : null}
                            {supportsEffort ? (
                              <ChevronRightIcon
                                aria-hidden
                                className="size-4 shrink-0 opacity-50"
                              />
                            ) : null}
                          </DropdownMenuItem>
                        )
                      })}
                    </DropdownMenuGroup>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <MorphMenuFooter
          className="justify-between"
          label="Collapse model picker"
          onCollapse={closeMenu}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDownIcon aria-hidden className="size-4 shrink-0 opacity-50" />
        </MorphMenuFooter>
      </MorphMenuContent>
    </DropdownMenu>
  )
}
