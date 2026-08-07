import { useEffect, useState } from 'react'
import { LaptopIcon, MoonIcon, SunIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Input } from '@/components/ui/input'
import type { AppearancePreference } from '@/hooks/useAppearance'

export function GeneralSettingsSection({
  appearancePreference,
  onAppearanceChange,
  onMessage,
  open,
}: {
  appearancePreference: AppearancePreference
  onAppearanceChange: (preference: AppearancePreference) => void
  onMessage: (message: string) => void
  open: boolean
}) {
  const [workspaceDirectory, setWorkspaceDirectory] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void window.arkDesktop.settings
      .get()
      .then((settings) => {
        if (!cancelled) setWorkspaceDirectory(settings.defaultWorkspaceDirectory ?? '')
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
    </div>
  )
}
