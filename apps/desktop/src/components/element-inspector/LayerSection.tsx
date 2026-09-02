import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'

import { ButtonGroup } from '@/components/ui/button-group'

import { InspectorIconButton, InspectorSection } from './InspectorField'

export function LayerSection({
  canModifyLayer,
  onReorder,
  zIndex,
}: {
  canModifyLayer: boolean
  onReorder: (direction: 'front' | 'back') => void
  zIndex: number | null
}) {
  return (
    <InspectorSection title="Layer">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--ark-titlebar-muted)]">
          Z-index <span className="text-[var(--ark-titlebar-fg)]">{zIndex ?? 'auto'}</span>
        </span>
        <ButtonGroup aria-label="Layer order">
          <InspectorIconButton
            disabled={!canModifyLayer}
            label="Bring forward"
            onClick={() => onReorder('front')}
          >
            <ArrowUpIcon className="size-3.5" />
          </InspectorIconButton>
          <InspectorIconButton
            disabled={!canModifyLayer}
            label="Send backward"
            onClick={() => onReorder('back')}
          >
            <ArrowDownIcon className="size-3.5" />
          </InspectorIconButton>
        </ButtonGroup>
      </div>
    </InspectorSection>
  )
}
