import { useMemo, useState } from 'react'
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

  const selectModel = (model: AvailableModel, effort?: ReasoningEffort) => {
    if (!model.available) {
      return
    }

    const supported = model.reasoningEfforts ?? []
    if (supported.length === 0) {
      onSelect(model.id)
      setOpen(false)
      setQuery('')
      return
    }

    const nextEffort =
      effort && supported.includes(effort)
        ? effort
        : model.id === value && reasoningEffort && supported.includes(reasoningEffort)
          ? reasoningEffort
          : (model.defaultReasoningEffort ?? supported[0])

    onSelect(model.id, nextEffort)
    setOpen(false)
    setQuery('')
  }

  return (
    <DropdownMenu
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          setQuery('')
        }
      }}
      open={open}
    >
      <DropdownMenuTrigger asChild>
        <Button
          aria-expanded={open}
          aria-label="Select model"
          className={cn(
            'max-w-[260px] justify-between border-none bg-transparent font-medium text-muted-foreground shadow-none',
            'hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground',
            'origin-bottom transition-[max-width,background-color,color,box-shadow] duration-150',
            'motion-reduce:transition-none',
            open &&
              'max-w-[320px] bg-[var(--ark-paper)] text-foreground shadow-md ring-1 ring-[var(--ark-line)]',
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
      <DropdownMenuContent
        align="start"
        className={cn(
          'w-80 border-[var(--ark-line)] bg-[var(--ark-paper)] p-0 text-[var(--ark-ink)] shadow-md',
          'origin-bottom motion-reduce:animate-none',
        )}
        side="top"
        sideOffset={8}
      >
        <div className="flex items-center gap-2 border-b border-[var(--ark-line)] px-2.5 py-2">
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

        <div className="max-h-72 overflow-y-auto p-1">
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
                    const efforts = model.reasoningEfforts ?? []
                    const supportsEffort = efforts.length > 0

                    if (!supportsEffort) {
                      return (
                        <DropdownMenuItem
                          className={cn('items-start gap-2 py-2', !model.available && 'opacity-60')}
                          disabled={!model.available}
                          key={model.id}
                          onSelect={() => selectModel(model)}
                        >
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate font-medium text-[var(--ark-ink)]">
                              {formatModelName(model)}
                            </span>
                            <span className="truncate font-mono text-[0.7rem] text-[var(--ark-muted-ink)]">
                              {model.modelId}
                            </span>
                          </div>
                          {unavailableLabel ? (
                            <span className="mt-0.5 shrink-0 rounded-md border border-[var(--ark-line)] px-1.5 py-0.5 text-[0.65rem] text-[var(--ark-muted-ink)]">
                              {unavailableLabel}
                            </span>
                          ) : null}
                          {isSelected ? (
                            <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                          ) : null}
                        </DropdownMenuItem>
                      )
                    }

                    return (
                      <DropdownMenuSub key={model.id}>
                        <DropdownMenuSubTrigger
                          className={cn(
                            'items-start gap-2 py-2',
                            !model.available && 'opacity-60',
                            isSelected && 'bg-accent text-accent-foreground',
                          )}
                          disabled={!model.available}
                        >
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate font-medium text-[var(--ark-ink)]">
                              {formatModelName(model)}
                            </span>
                            <span className="truncate font-mono text-[0.7rem] text-[var(--ark-muted-ink)]">
                              {model.modelId}
                            </span>
                          </div>
                          {unavailableLabel ? (
                            <span className="mt-0.5 shrink-0 rounded-md border border-[var(--ark-line)] px-1.5 py-0.5 text-[0.65rem] text-[var(--ark-muted-ink)]">
                              {unavailableLabel}
                            </span>
                          ) : null}
                          {isSelected ? (
                            <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                          ) : null}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent
                          className="border-[var(--ark-line)] bg-[var(--ark-paper)] text-[var(--ark-ink)]"
                          sideOffset={6}
                        >
                          <DropdownMenuLabel>Thinking effort</DropdownMenuLabel>
                          {efforts.map((effort) => {
                            const effortSelected =
                              isSelected &&
                              reasoningEffort &&
                              efforts.includes(reasoningEffort) &&
                              reasoningEffort === effort

                            return (
                              <DropdownMenuItem
                                key={effort}
                                onSelect={() => {
                                  selectModel(model, effort)
                                }}
                              >
                                <span className="flex-1">{formatReasoningEffortLabel(effort)}</span>
                                {effortSelected ? (
                                  <CheckIcon aria-hidden className="size-4 shrink-0" />
                                ) : null}
                              </DropdownMenuItem>
                            )
                          })}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )
                  })}
                </DropdownMenuGroup>
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
