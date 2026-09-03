import { useId } from 'react'
import { ScanIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button-variants'
import { cn } from '@/lib/ui/utils'
import type { ImageFitMode } from '@ark/deck/document/image.ts'
import type { EditorSelectionImageSize } from '@ark/editor-runtime'
import { formatImageNaturalSize } from '@/lib/editor/element-inspector'

import {
  CommitTextField,
  InspectorRow,
  InspectorSection,
  inspectorFieldClassName,
} from './InspectorField'

export function ImageSection({
  altText,
  canModify,
  imageFit,
  naturalSize,
  onCommitAlt,
  onCommitImageFit,
  onResetAspect,
  resetEnabled,
}: {
  altText: string
  canModify: boolean
  imageFit: ImageFitMode
  naturalSize: EditorSelectionImageSize | null
  onCommitAlt: (alt: string) => void
  onCommitImageFit: (fit: ImageFitMode) => void
  onResetAspect: () => void
  resetEnabled: boolean
}) {
  const fitSelectId = useId()

  return (
    <InspectorSection title="Image">
      <CommitTextField
        disabled={!canModify}
        label="Alt text"
        onCommit={onCommitAlt}
        placeholder="Describe image"
        value={altText}
      />
      <label className="flex items-center justify-between gap-2 text-[11px]" htmlFor={fitSelectId}>
        <span className="text-[var(--ark-titlebar-muted)]">Fit</span>
        <select
          aria-label="Image fit mode"
          className={cn(inspectorFieldClassName, 'w-28 flex-none')}
          disabled={!canModify}
          id={fitSelectId}
          onChange={(event) => onCommitImageFit(event.target.value as ImageFitMode)}
          value={imageFit}
        >
          <option value="contain">Contain</option>
          <option value="cover">Cover</option>
          <option value="fill">Fill</option>
        </select>
      </label>
      <InspectorRow label="Intrinsic">{formatImageNaturalSize(naturalSize)}</InspectorRow>
      <button
        aria-label="Reset to image aspect ratio"
        className={cn(
          buttonVariants({ size: 'sm', variant: 'ghost' }),
          'h-6 justify-start gap-1.5 rounded-sm border border-[var(--ark-titlebar-border)] px-2 text-[11px] text-[var(--ark-titlebar-fg)] shadow-none',
          'hover:bg-[var(--ark-titlebar-hover)]',
          'disabled:cursor-not-allowed disabled:text-[var(--ark-titlebar-muted)]/50',
        )}
        disabled={!canModify || !resetEnabled}
        onClick={onResetAspect}
        type="button"
      >
        <ScanIcon aria-hidden className="size-3.5" />
        Reset aspect ratio
      </button>
    </InspectorSection>
  )
}
