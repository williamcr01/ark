import { useMemo, useRef, useState } from 'react'
import { ALL_PROVIDERS, type ProviderId } from '@ark/contracts'

import { DropdownMenu } from '@/components/ui/dropdown-menu'
import { useAnimatedHeight } from '@/hooks/useAnimatedHeight'
import {
  EMPTY_MODEL_CATALOG_COPY,
  formatModelName,
  formatProviderLabel,
  type AvailableModel,
} from '@/hooks/useAvailableModels'
import { formatReasoningEffortLabel, type ReasoningEffort } from '@/hooks/useReasoningEffort'
import { useSequencedPresence } from '@/hooks/useSequencedPresence'

import { ModelSelectorMenu } from './ModelSelectorMenu.tsx'
import { ModelSelectorTrigger } from './ModelSelectorTrigger.tsx'

const groupModelsByProvider = (models: AvailableModel[]) => {
  const groups = new Map<ProviderId, AvailableModel[]>()

  for (const provider of ALL_PROVIDERS) {
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

  const sections: {
    provider: ProviderId
    label: string
    models: AvailableModel[]
    readyCount: number
  }[] = []

  for (const [provider, providerModels] of groups) {
    if (providerModels.length === 0) {
      continue
    }

    sections.push({
      provider,
      label: formatProviderLabel(provider),
      models: providerModels,
      readyCount: providerModels.length,
    })
  }

  return sections
}

const modelMatchesQuery = (model: AvailableModel, query: string) => {
  if (!query) {
    return true
  }

  const haystack =
    `${formatProviderLabel(model.provider)} ${formatModelName(model)} ${model.modelId} ${model.id}`.toLowerCase()
  return haystack.includes(query)
}

function resolveModelEffort(
  model: AvailableModel,
  value: string,
  reasoningEffort: ReasoningEffort | undefined,
  getReasoningEffort?: (modelId: string) => ReasoningEffort | undefined,
) {
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

  const selectedName = selected ? formatModelName(selected) : 'Select model'
  const emptyCatalog = !isLoading && models.length === 0
  const effortLabel =
    selected && reasoningEffort ? formatReasoningEffortLabel(reasoningEffort) : undefined
  const triggerLabel = isLoading
    ? 'Loading models…'
    : emptyCatalog
      ? EMPTY_MODEL_CATALOG_COPY
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

    const nextEffort =
      effort && supported.includes(effort)
        ? effort
        : resolveModelEffort(model, value, reasoningEffort, getReasoningEffort)

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
      <ModelSelectorTrigger
        canGenerate={canGenerate}
        className={className}
        disabled={disabled}
        emptyCatalog={emptyCatalog}
        effortLabel={effortLabel}
        isLoading={isLoading}
        open={open}
        selected={selected}
        selectedName={selectedName}
        triggerLabel={triggerLabel}
      />
      <ModelSelectorMenu
        capturePanelHeight={capturePanelHeight}
        closeMenu={closeMenu}
        effortAnchor={effortAnchor}
        effortModel={effortModel}
        effortWing={effortWing}
        groups={groups}
        models={models}
        panelRef={panelRef}
        query={query}
        resolveModelEffort={(model) =>
          resolveModelEffort(model, value, reasoningEffort, getReasoningEffort)
        }
        selectModel={selectModel}
        setQuery={setQuery}
        toggleEffortEditor={toggleEffortEditor}
        triggerLabel={triggerLabel}
        value={value}
      />
    </DropdownMenu>
  )
}
