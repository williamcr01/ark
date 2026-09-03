import { useState } from 'react'

import { AiProvidersSettingsSection } from '@/components/AiProvidersSettingsSection'
import { GeneralSettingsSection } from '@/components/GeneralSettingsSection'
import { McpSettingsSection } from '@/components/McpSettingsSection'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { AppearancePreference } from '@/hooks/useAppearance'
import type { SettingsTab } from '@/lib/ui/settings-tab'

export type { SettingsTab }

const EMPTY_CATALOG_WARNINGS: string[] = []

export function DesktopSettingsDialog({
  appearancePreference,
  catalogWarnings = EMPTY_CATALOG_WARNINGS,
  initialTab = 'general',
  onAgentInteractionsInModalChange,
  onAppearanceChange,
  onCredentialsChanged,
  onOpenChange,
  open,
}: {
  appearancePreference: AppearancePreference
  catalogWarnings?: string[]
  initialTab?: SettingsTab
  onAgentInteractionsInModalChange?: (enabled: boolean) => void
  onAppearanceChange: (preference: AppearancePreference) => void
  onCredentialsChanged: () => void | Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const [message, setMessage] = useState('')

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="h-[min(680px,calc(100svh-2rem))] grid-rows-[auto_minmax(0,1fr)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Tabs className="flex flex-1 gap-4 overflow-hidden" defaultValue={initialTab}>
          <TabsList className="w-40 shrink-0 flex-col items-stretch self-start">
            <TabsTrigger className="justify-start" value="general">
              General
            </TabsTrigger>
            <TabsTrigger className="justify-start" value="mcp">
              MCP
            </TabsTrigger>
            <TabsTrigger className="justify-start" value="providers">
              AI Providers
            </TabsTrigger>
          </TabsList>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            <TabsContent value="general">
              <GeneralSettingsSection
                appearancePreference={appearancePreference}
                onAgentInteractionsInModalChange={onAgentInteractionsInModalChange}
                onAppearanceChange={onAppearanceChange}
                onMessage={setMessage}
                open={open}
              />
            </TabsContent>
            <TabsContent value="mcp">
              <McpSettingsSection onMessage={setMessage} open={open} />
            </TabsContent>
            <TabsContent value="providers">
              <AiProvidersSettingsSection
                catalogWarnings={catalogWarnings}
                onCredentialsChanged={onCredentialsChanged}
                onMessage={setMessage}
                open={open}
              />
            </TabsContent>
            {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
