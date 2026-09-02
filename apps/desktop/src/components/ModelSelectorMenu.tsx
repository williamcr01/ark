import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from 'lucide-react'
import type { RefObject } from 'react'

import { ProviderLogo } from '@/components/ProviderLogo'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  MorphMenuContent,
  MorphMenuFooter,
  MorphMenuWing,
  morphMenuSurfaceClassName,
} from '@/components/ui/morph-menu'
import {
  EMPTY_MODEL_CATALOG_COPY,
  formatModelName,
  type AvailableModel,
} from '@/hooks/useAvailableModels'
import { formatReasoningEffortLabel, type ReasoningEffort } from '@/hooks/useReasoningEffort'
import { cn } from '@/lib/ui/utils'

export type ModelGroup = {
  provider: AvailableModel['provider']
  label: string
  models: AvailableModel[]
  readyCount: number
}

function ModelSelectorRow({
  effortModelId,
  model,
  resolveModelEffort,
  selectModel,
  toggleEffortEditor,
  value,
}: {
  effortModelId: string | undefined
  model: AvailableModel
  resolveModelEffort: (model: AvailableModel) => ReasoningEffort | undefined
  selectModel: (model: AvailableModel, effort?: ReasoningEffort) => void
  toggleEffortEditor: (model: AvailableModel, row: HTMLElement) => void
  value: string
}) {
  const isSelected = model.id === value
  const supportsEffort = (model.reasoningEfforts ?? []).length > 0
  const canEditEffort = model.available && supportsEffort
  const modelEffort = resolveModelEffort(model)
  const isExpanded = effortModelId === model.id

  return (
    <div className="relative" data-model-row>
      <DropdownMenuItem
        className={cn(
          'gap-2 py-1.5',
          canEditEffort && 'pr-10',
          isExpanded && 'bg-accent text-accent-foreground',
        )}
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
        {isSelected ? <CheckIcon aria-hidden className="size-3.5 shrink-0" /> : null}
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
            const row = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>(
              '[data-model-row]',
            )
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
}

function ModelSelectorEffortWing({
  effortAnchor,
  effortModel,
  effortWing,
  panelRef,
  resolveModelEffort,
  selectModel,
}: {
  effortAnchor: number
  effortModel: AvailableModel
  effortWing: { completeExit: () => void; state: 'open' | 'closed' }
  panelRef: RefObject<HTMLDivElement | null>
  resolveModelEffort: (model: AvailableModel) => ReasoningEffort | undefined
  selectModel: (model: AvailableModel, effort?: ReasoningEffort) => void
}) {
  return (
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
  )
}

export function ModelSelectorMenu({
  capturePanelHeight,
  closeMenu,
  effortAnchor,
  effortModel,
  effortWing,
  groups,
  models,
  panelRef,
  query,
  resolveModelEffort,
  selectModel,
  setQuery,
  toggleEffortEditor,
  triggerLabel,
  value,
}: {
  capturePanelHeight: () => void
  closeMenu: () => void
  effortAnchor: number
  effortModel: AvailableModel | null
  effortWing: { completeExit: () => void; state: 'open' | 'closed' }
  groups: ModelGroup[]
  models: AvailableModel[]
  panelRef: RefObject<HTMLDivElement | null>
  query: string
  resolveModelEffort: (model: AvailableModel) => ReasoningEffort | undefined
  selectModel: (model: AvailableModel, effort?: ReasoningEffort) => void
  setQuery: (query: string) => void
  toggleEffortEditor: (model: AvailableModel, row: HTMLElement) => void
  triggerLabel: string
  value: string
}) {
  return (
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
                {models.length === 0 ? EMPTY_MODEL_CATALOG_COPY : 'No models match your search.'}
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
                    {group.models.map((model) => (
                      <ModelSelectorRow
                        effortModelId={effortModel?.id}
                        key={model.id}
                        model={model}
                        resolveModelEffort={resolveModelEffort}
                        selectModel={selectModel}
                        toggleEffortEditor={toggleEffortEditor}
                        value={value}
                      />
                    ))}
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

      {effortModel ? (
        <ModelSelectorEffortWing
          effortAnchor={effortAnchor}
          effortModel={effortModel}
          effortWing={effortWing}
          panelRef={panelRef}
          resolveModelEffort={resolveModelEffort}
          selectModel={selectModel}
        />
      ) : null}
    </MorphMenuContent>
  )
}
