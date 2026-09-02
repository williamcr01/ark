import { useState } from 'react'
import {
  CopyIcon,
  FileUpIcon,
  FolderInputIcon,
  FolderOpenIcon,
  MapPinIcon,
  MoreHorizontalIcon,
  Share2Icon,
  UploadIcon,
} from 'lucide-react'

import { buttonVariants } from '@/components/ui/button-variants'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/ui/utils'

import { TitleBarButton } from './TitleBarButton'
import type { AppTitleBarVariant } from './title-bar-types'

type TitleBarFileMenuModel = {
  activeDeckId: string | null
  isGenerating: boolean
  onDuplicate: () => void
  onMove: () => void
  onOpenWorkspace: () => void
  onPptxImportClick: () => void
  onReveal: () => void
  onSaveAs: () => void
  onShareProject: () => void
  onUploadClick: () => void
  variant: AppTitleBarVariant
}

export function TitleBarFileMenu({
  activeDeckId,
  isGenerating,
  onDuplicate,
  onMove,
  onOpenWorkspace,
  onPptxImportClick,
  onReveal,
  onSaveAs,
  onShareProject,
  onUploadClick,
  variant,
}: TitleBarFileMenuModel) {
  if (variant === 'library') {
    return (
      <LibraryFileButtons
        isGenerating={isGenerating}
        onOpenWorkspace={onOpenWorkspace}
        onPptxImportClick={onPptxImportClick}
        onUploadClick={onUploadClick}
      />
    )
  }

  if (variant === 'home') {
    return (
      <HomeFileMenu
        isGenerating={isGenerating}
        onOpenWorkspace={onOpenWorkspace}
        onPptxImportClick={onPptxImportClick}
        onUploadClick={onUploadClick}
      />
    )
  }

  return (
    <EditorFileButtons
      activeDeckId={activeDeckId}
      isGenerating={isGenerating}
      onDuplicate={onDuplicate}
      onMove={onMove}
      onOpenWorkspace={onOpenWorkspace}
      onReveal={onReveal}
      onSaveAs={onSaveAs}
      onShareProject={onShareProject}
    />
  )
}

function LibraryFileButtons({
  isGenerating,
  onOpenWorkspace,
  onPptxImportClick,
  onUploadClick,
}: {
  isGenerating: boolean
  onOpenWorkspace: () => void
  onPptxImportClick: () => void
  onUploadClick: () => void
}) {
  return (
    <>
      <TitleBarButton disabled={isGenerating} label="Open Ark workspace" onClick={onOpenWorkspace}>
        <FolderOpenIcon />
      </TitleBarButton>
      <TitleBarButton disabled={isGenerating} label="Upload HTML" onClick={onUploadClick}>
        <UploadIcon />
      </TitleBarButton>
      <TitleBarButton disabled={isGenerating} label="Import PowerPoint" onClick={onPptxImportClick}>
        <FileUpIcon />
      </TitleBarButton>
    </>
  )
}

function EditorFileButtons({
  activeDeckId,
  isGenerating,
  onDuplicate,
  onMove,
  onOpenWorkspace,
  onReveal,
  onSaveAs,
  onShareProject,
}: Omit<TitleBarFileMenuModel, 'variant' | 'onPptxImportClick' | 'onUploadClick'>) {
  return (
    <>
      <TitleBarButton disabled={isGenerating} label="Open Ark workspace" onClick={onOpenWorkspace}>
        <FolderOpenIcon />
      </TitleBarButton>
      <TitleBarButton disabled={!activeDeckId || isGenerating} label="Save As" onClick={onSaveAs}>
        <CopyIcon />
      </TitleBarButton>
      <TitleBarButton
        disabled={!activeDeckId || isGenerating}
        label="Move workspace"
        onClick={onMove}
      >
        <FolderInputIcon />
      </TitleBarButton>
      <TitleBarButton disabled={!activeDeckId} label="Reveal in file manager" onClick={onReveal}>
        <MapPinIcon />
      </TitleBarButton>
      <TitleBarButton
        disabled={!activeDeckId || isGenerating}
        label="Duplicate presentation"
        onClick={onDuplicate}
      >
        <CopyIcon />
      </TitleBarButton>
      <TitleBarButton
        disabled={!activeDeckId || isGenerating}
        label="Share Ark Project"
        onClick={onShareProject}
      >
        <Share2Icon />
      </TitleBarButton>
    </>
  )
}

export function TitleBarImportButtons({
  isGenerating,
  onPptxImportClick,
  onUploadClick,
}: {
  isGenerating: boolean
  onPptxImportClick: () => void
  onUploadClick: () => void
}) {
  return (
    <>
      <TitleBarButton disabled={isGenerating} label="Upload HTML" onClick={onUploadClick}>
        <UploadIcon />
      </TitleBarButton>
      <TitleBarButton disabled={isGenerating} label="Import PowerPoint" onClick={onPptxImportClick}>
        <FileUpIcon />
      </TitleBarButton>
    </>
  )
}

function HomeFileMenu({
  isGenerating,
  onOpenWorkspace,
  onPptxImportClick,
  onUploadClick,
}: {
  isGenerating: boolean
  onOpenWorkspace: () => void
  onPptxImportClick: () => void
  onUploadClick: () => void
}) {
  const [fileMenuOpen, setFileMenuOpen] = useState(false)

  return (
    <DropdownMenu onOpenChange={setFileMenuOpen} open={fileMenuOpen}>
      <Tooltip>
        <DropdownMenuTrigger asChild>
          <TooltipTrigger asChild>
            <button
              aria-label="File actions"
              className={cn(
                buttonVariants({ size: 'icon-sm', variant: 'ghost' }),
                'size-[26px] rounded-sm border-0 text-[var(--ark-titlebar-fg)] shadow-none',
                'hover:!bg-transparent dark:hover:!bg-transparent active:!translate-y-0',
                'aria-expanded:!bg-transparent',
              )}
              disabled={isGenerating}
              type="button"
            >
              <span aria-hidden className="inline-flex">
                <MoreHorizontalIcon />
              </span>
            </button>
          </TooltipTrigger>
        </DropdownMenuTrigger>
        <TooltipContent side="bottom">File actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={isGenerating} onSelect={onOpenWorkspace}>
          <FolderOpenIcon />
          Open Ark workspace
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isGenerating} onSelect={onUploadClick}>
          <UploadIcon />
          Upload HTML
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isGenerating} onSelect={onPptxImportClick}>
          <FileUpIcon />
          Import PowerPoint
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
