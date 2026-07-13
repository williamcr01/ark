import { useState } from 'react'
import { ChevronsUpDownIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import {
  formatModelName,
  formatProviderLabel,
  formatUnavailableBadge,
  type AvailableModel,
} from '@/hooks/useAvailableModels'
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

export type ModelSelectorProps = {
  models: AvailableModel[]
  value: string
  onValueChange: (modelId: string) => void
  disabled?: boolean
  isLoading?: boolean
  canGenerate?: boolean
  className?: string
}

export function ModelSelector({
  models,
  value,
  onValueChange,
  disabled = false,
  isLoading = false,
  canGenerate = true,
  className,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false)

  const selected = models.find((model) => model.id === value)
  const groups = groupModelsByProvider(models)

  const triggerLabel = isLoading
    ? 'Loading models…'
    : selected
      ? formatModelName(selected)
      : 'Select model'

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          aria-label="Select model"
          className={cn(
            'max-w-[220px] justify-between border-none bg-transparent font-medium text-muted-foreground shadow-none',
            'hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground',
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
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 border-[var(--ark-line)] bg-[var(--ark-paper)] p-0 text-[var(--ark-ink)] shadow-md"
        side="top"
        sideOffset={8}
      >
        <Command className="rounded-lg bg-transparent">
          <CommandInput placeholder="Search models…" />
          <CommandList className="max-h-72">
            <CommandEmpty>
              {models.length === 0 ? 'No models available.' : 'No models match your search.'}
            </CommandEmpty>
            {groups.map((group) => (
              <CommandGroup
                heading={`${group.label} · ${group.readyCount} ready`}
                key={group.provider}
              >
                {group.models.map((model) => {
                  const unavailableLabel = formatUnavailableBadge(model)
                  const isSelected = model.id === value

                  return (
                    <CommandItem
                      className={cn('items-start gap-2 py-2', !model.available && 'opacity-60')}
                      data-checked={isSelected || undefined}
                      disabled={!model.available}
                      key={model.id}
                      onSelect={() => {
                        if (!model.available) {
                          return
                        }

                        onValueChange(model.id)
                        setOpen(false)
                      }}
                      value={`${group.label} ${formatModelName(model)} ${model.modelId} ${model.id}`}
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
                        <Badge className="mt-0.5 shrink-0" variant="outline">
                          {unavailableLabel}
                        </Badge>
                      ) : null}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
