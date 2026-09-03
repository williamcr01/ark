import { ButtonGroup } from '@/components/ui/button-group'
import { useDashboardFileActions, type DashboardFileActions } from '@/hooks/useDashboardFileActions'

import { TitleBarBrand } from './TitleBarBrand'
import { TitleBarFileInputs } from './TitleBarFileInputs'
import { TitleBarFileMenu } from './TitleBarFileMenu'
import { TitleBarNavTabs } from './TitleBarNavTabs'
import { TitleBarSettingsButton } from './TitleBarSettingsButton'
import type { AppTitleBarNav, AppTitleBarVariant } from './title-bar-types'

export function DashboardTitleBar({
  fileActions,
  navActive,
  variant,
}: {
  fileActions?: DashboardFileActions
  navActive: AppTitleBarNav
  variant: Exclude<AppTitleBarVariant, 'editor'>
}) {
  if (fileActions) {
    return (
      <DashboardTitleBarChrome fileActions={fileActions} navActive={navActive} variant={variant} />
    )
  }

  return <DashboardTitleBarWithLocalFiles navActive={navActive} variant={variant} />
}

function DashboardTitleBarWithLocalFiles({
  navActive,
  variant,
}: {
  navActive: AppTitleBarNav
  variant: Exclude<AppTitleBarVariant, 'editor'>
}) {
  const fileActions = useDashboardFileActions()
  return (
    <DashboardTitleBarChrome fileActions={fileActions} navActive={navActive} variant={variant} />
  )
}

function DashboardTitleBarChrome({
  fileActions,
  navActive,
  variant,
}: {
  fileActions: DashboardFileActions
  navActive: AppTitleBarNav
  variant: Exclude<AppTitleBarVariant, 'editor'>
}) {
  const isGenerating = fileActions.isUploading

  return (
    <>
      <TitleBarFileInputs
        fileInputRef={fileActions.refs.fileInputRef}
        onHtmlUpload={fileActions.handleHtmlUpload}
        onPptxUpload={fileActions.handlePptxUpload}
        pptxFileInputRef={fileActions.refs.pptxFileInputRef}
      />
      <div className="flex min-w-0 items-center gap-3 px-1">
        <TitleBarBrand />
        <TitleBarNavTabs
          disabled={isGenerating}
          navActive={navActive}
          onNew={fileActions.handleNewDeck}
        />
      </div>
      <div aria-hidden className="min-w-0 flex-1" />
      <ButtonGroup className="shrink-0">
        <TitleBarSettingsButton />
        <TitleBarFileMenu
          activeDeckId={null}
          isGenerating={isGenerating}
          onDuplicate={noop}
          onMove={noop}
          onOpenWorkspace={() => void fileActions.handleOpenWorkspace()}
          onPptxImportClick={fileActions.handlePptxImportClick}
          onReveal={noop}
          onSaveAs={noop}
          onShareProject={noop}
          onUploadClick={fileActions.handleUploadClick}
          variant={variant}
        />
      </ButtonGroup>
    </>
  )
}

function noop() {
  return undefined
}
