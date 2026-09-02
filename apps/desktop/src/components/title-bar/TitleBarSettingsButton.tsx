import { useEffect, useState } from 'react'
import { CableIcon, SettingsIcon } from 'lucide-react'
import type { McpStatus } from '@ark/contracts'

import { DesktopSettingsDialog } from '@/components/DesktopSettingsDialog'
import type { SettingsTab } from '@/lib/ui/settings-tab'
import { useModelsStore } from '@/state/models-store.ts'
import { useShellStore } from '@/state/shell-store.ts'

import { TitleBarButton } from './TitleBarButton'

export function TitleBarSettingsButton({
  onCredentialsChanged,
  showMcp = false,
}: {
  onCredentialsChanged?: () => void | Promise<void>
  showMcp?: boolean
}) {
  const { mcpStatus, settingsOpen, settingsTab, setSettingsOpen, setSettingsTab } =
    useTitleBarMenus()
  const appearancePreference = useShellStore((state) => state.appearancePreference)
  const setAppearancePreference = useShellStore((state) => state.setAppearancePreference)
  const setAgentInteractionsInModal = useShellStore((state) => state.setAgentInteractionsInModal)
  const catalogWarnings = useModelsStore((state) => state.warnings)

  return (
    <>
      {showMcp ? (
        <TitleBarButton
          label="MCP settings"
          onClick={() => {
            setSettingsTab('mcp')
            setSettingsOpen(true)
          }}
        >
          <span className="relative inline-flex">
            <CableIcon />
            {mcpStatus?.state === 'running' ? (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-emerald-500 ring-1 ring-[var(--ark-panel-raised)]"
                data-testid="mcp-running-indicator"
              />
            ) : null}
          </span>
        </TitleBarButton>
      ) : null}
      <TitleBarButton
        label="Settings"
        onClick={() => {
          setSettingsTab('general')
          setSettingsOpen(true)
        }}
      >
        <SettingsIcon />
      </TitleBarButton>
      <DesktopSettingsDialog
        appearancePreference={appearancePreference}
        catalogWarnings={catalogWarnings}
        initialTab={settingsTab}
        onAgentInteractionsInModalChange={setAgentInteractionsInModal}
        onAppearanceChange={setAppearancePreference}
        onCredentialsChanged={onCredentialsChanged ?? noopCredentials}
        onOpenChange={setSettingsOpen}
        open={settingsOpen}
      />
    </>
  )
}

function noopCredentials() {
  return undefined
}

function useTitleBarMenus() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const mcpStatus = useMcpTitleBarStatus()

  return { mcpStatus, settingsOpen, settingsTab, setSettingsOpen, setSettingsTab }
}

function useMcpTitleBarStatus() {
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.arkDesktop.mcp.getStatus().then((status) => {
      if (!cancelled) setMcpStatus(status)
    })
    const unsubscribe = window.arkDesktop.mcp.onStatusChanged((status) => {
      if (!cancelled) setMcpStatus(status)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return mcpStatus
}
