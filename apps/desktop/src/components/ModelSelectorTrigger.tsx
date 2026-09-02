import { ChevronsUpDownIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { morphMenuTriggerClassName } from '@/components/ui/morph-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { ProviderLogo } from '@/components/ProviderLogo'
import { EMPTY_MODEL_CATALOG_COPY, type AvailableModel } from '@/hooks/useAvailableModels'
import { cn } from '@/lib/ui/utils'

import { ModelSelectorTriggerLabel } from './ModelSelectorTriggerLabel.tsx'

export function ModelSelectorTrigger({
  canGenerate,
  className,
  disabled,
  emptyCatalog,
  effortLabel,
  isLoading,
  open,
  selected,
  selectedName,
  triggerLabel,
}: {
  canGenerate: boolean
  className?: string
  disabled: boolean
  emptyCatalog: boolean
  effortLabel?: string
  isLoading: boolean
  open: boolean
  selected?: AvailableModel
  selectedName: string
  triggerLabel: string
}) {
  return (
    <DropdownMenuTrigger asChild>
      <Button
        aria-expanded={open}
        aria-label="Select model"
        className={cn(
          morphMenuTriggerClassName,
          'h-8 min-w-0 max-w-full shrink justify-start rounded-md font-medium text-[var(--ark-ink)] sm:max-w-[260px]',
          'motion-reduce:transition-none',
          !canGenerate && 'text-muted-foreground',
          className,
        )}
        disabled={disabled || isLoading || emptyCatalog}
        size="sm"
        title={isLoading ? undefined : triggerLabel}
        type="button"
        variant="ghost"
      >
        {isLoading ? (
          <Skeleton className="h-3.5 w-24" />
        ) : (
          <>
            {selected && !emptyCatalog ? (
              <ProviderLogo className="size-4" provider={selected.provider} />
            ) : null}
            <ModelSelectorTriggerLabel
              effortLabel={emptyCatalog ? undefined : effortLabel}
              modelName={emptyCatalog ? EMPTY_MODEL_CATALOG_COPY : selectedName}
            />
          </>
        )}
        <ChevronsUpDownIcon className="opacity-50" data-icon="inline-end" />
      </Button>
    </DropdownMenuTrigger>
  )
}
