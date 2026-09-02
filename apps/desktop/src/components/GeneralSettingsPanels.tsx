import { LaptopIcon, MoonIcon, SunIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Input } from '@/components/ui/input'
import type { AppearancePreference } from '@/hooks/useAppearance'
import { updateDesktopSettings } from '@/lib/ui/desktop-settings'

export function AppearanceSettingsPanel({
  appearancePreference,
  onAppearanceChange,
}: {
  appearancePreference: AppearancePreference
  onAppearanceChange: (preference: AppearancePreference) => void
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="font-medium">Appearance</h2>
        <p className="text-xs text-muted-foreground">Choose how Ark looks on this device.</p>
      </div>
      <ToggleGroup
        aria-label="Appearance"
        className="w-full"
        onValueChange={(value) => {
          if (value) onAppearanceChange(value as AppearancePreference)
        }}
        type="single"
        value={appearancePreference}
      >
        <ToggleGroupItem aria-label="System theme" className="flex-1" value="system">
          <LaptopIcon />
          System
        </ToggleGroupItem>
        <ToggleGroupItem aria-label="Light theme" className="flex-1" value="light">
          <SunIcon />
          Light
        </ToggleGroupItem>
        <ToggleGroupItem aria-label="Dark theme" className="flex-1" value="dark">
          <MoonIcon />
          Dark
        </ToggleGroupItem>
      </ToggleGroup>
    </section>
  )
}

export function AgentPromptsSettingsPanel({
  agentInteractionsInModal,
  onAgentInteractionsInModalChange,
  setAgentInteractionsInModal,
}: {
  agentInteractionsInModal: boolean
  onAgentInteractionsInModalChange?: (enabled: boolean) => void
  setAgentInteractionsInModal: (enabled: boolean) => void
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="font-medium">Agent prompts</h2>
        <p className="text-xs text-muted-foreground">
          Keep Ark’s questions and theme choices visible while the chat panel is closed.
        </p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          aria-label="Show Ark agent prompts in a modal"
          checked={agentInteractionsInModal}
          onCheckedChange={(checked) => {
            const next = checked === true
            setAgentInteractionsInModal(next)
            onAgentInteractionsInModalChange?.(next)
            void updateDesktopSettings({ agentInteractionsInModal: next })
          }}
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">Show Ark agent prompts in a modal</span>
        </span>
      </label>
    </section>
  )
}

export function WorkspaceDirectorySettingsPanel({
  workspaceDirectory,
  setWorkspaceDirectory,
}: {
  workspaceDirectory: string
  setWorkspaceDirectory: (directory: string) => void
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="font-medium">New workspace location</h2>
        <p className="text-xs text-muted-foreground">
          New .ark files are created here. Existing files are not moved.
        </p>
      </div>
      <div className="flex gap-2">
        <Input readOnly value={workspaceDirectory || 'Documents/Ark'} />
        <Button
          onClick={() => {
            void window.arkDesktop.files.chooseDirectory().then(async (directory) => {
              if (!directory) return
              await window.arkDesktop.settings.update({
                defaultWorkspaceDirectory: directory,
              })
              setWorkspaceDirectory(directory)
            })
          }}
          variant="outline"
        >
          Choose…
        </Button>
      </div>
    </section>
  )
}

export function UpdatesSettingsPanel({ onMessage }: { onMessage: (message: string) => void }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="font-medium">Updates</h2>
        <p className="text-xs text-muted-foreground">
          Check whether a newer version of Ark is available.
        </p>
      </div>
      <div className="flex justify-end">
        <Button
          onClick={() => {
            void window.arkDesktop.updates
              .check()
              .then((result) => {
                onMessage(result.ok ? 'Update check started.' : result.error)
              })
              .catch((error) => {
                onMessage(error instanceof Error ? error.message : 'Update check failed.')
              })
          }}
          variant="outline"
        >
          Check for updates
        </Button>
      </div>
    </section>
  )
}
