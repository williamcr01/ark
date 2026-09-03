import { useEffect, useState } from 'react'

import type { AppearancePreference } from '@/hooks/useAppearance'
import {
  AgentPromptsSettingsPanel,
  AppearanceSettingsPanel,
  UpdatesSettingsPanel,
  WorkspaceDirectorySettingsPanel,
} from './GeneralSettingsPanels.tsx'

export function GeneralSettingsSection({
  appearancePreference,
  onAgentInteractionsInModalChange,
  onAppearanceChange,
  onMessage,
  open,
}: {
  appearancePreference: AppearancePreference
  onAgentInteractionsInModalChange?: (enabled: boolean) => void
  onAppearanceChange: (preference: AppearancePreference) => void
  onMessage: (message: string) => void
  open: boolean
}) {
  const [workspaceDirectory, setWorkspaceDirectory] = useState('')
  const [agentInteractionsInModal, setAgentInteractionsInModal] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void window.arkDesktop.settings
      .get()
      .then((settings) => {
        if (cancelled) return
        setWorkspaceDirectory(settings.defaultWorkspaceDirectory ?? '')
        setAgentInteractionsInModal(settings.agentInteractionsInModal === true)
      })
      .catch((error) => {
        if (!cancelled)
          onMessage(error instanceof Error ? error.message : 'Could not load settings.')
      })
    return () => {
      cancelled = true
    }
  }, [onMessage, open])

  return (
    <div className="flex flex-col gap-6">
      <AppearanceSettingsPanel
        appearancePreference={appearancePreference}
        onAppearanceChange={onAppearanceChange}
      />
      <AgentPromptsSettingsPanel
        agentInteractionsInModal={agentInteractionsInModal}
        onAgentInteractionsInModalChange={onAgentInteractionsInModalChange}
        setAgentInteractionsInModal={setAgentInteractionsInModal}
      />
      <WorkspaceDirectorySettingsPanel
        setWorkspaceDirectory={setWorkspaceDirectory}
        workspaceDirectory={workspaceDirectory}
      />
      <UpdatesSettingsPanel onMessage={onMessage} />
    </div>
  )
}
