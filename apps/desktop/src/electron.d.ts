import type {
  ExternalDeckUpdate,
  McpInteractionAnswer,
  McpInteractionChanged,
  McpPendingInteraction,
  McpSetupCommands,
  McpStatus,
  ProviderId,
  ReasoningEffort,
} from '@ark/contracts'

type CredentialStatus = Record<
  ProviderId,
  { configured: boolean; storage: 'persistent' | 'session' | null }
>
type DesktopResult = { ok: true; modelCount?: number } | { ok: false; error: string }
type DesktopSettings = {
  appearance: 'system' | 'light' | 'dark'
  migratedLegacyRendererPreferences: boolean
  reasoningEffortByModel: Record<string, ReasoningEffort>
  selectedModel: string | null
  defaultWorkspaceDirectory: string | null
  mcpAutoStart: boolean
  agentInteractionsInModal: boolean
}

declare global {
  interface Window {
    arkDesktop: {
      credentials: {
        list: () => Promise<CredentialStatus>
        save: (provider: ProviderId, apiKey: string) => Promise<DesktopResult>
        saveSession: (provider: ProviderId, apiKey: string) => Promise<DesktopResult>
        remove: (provider: ProviderId) => Promise<DesktopResult>
        test: (provider: ProviderId, apiKey: string) => Promise<DesktopResult>
      }
      settings: {
        get: () => Promise<DesktopSettings>
        update: (patch: Partial<DesktopSettings>) => Promise<DesktopSettings>
      }
      mcp: {
        getStatus: () => Promise<McpStatus>
        start: () => Promise<McpStatus>
        stop: () => Promise<McpStatus>
        setAutoStart: (enabled: boolean) => Promise<McpStatus>
        setActiveDeck: (
          deckId: string | null,
          title: string | null,
          documentRevision: number | null,
        ) => Promise<void>
        getPendingInteraction: () => Promise<McpPendingInteraction | null>
        respondToInteraction: (id: string, answer: McpInteractionAnswer) => Promise<void>
        cancelInteraction: (id: string) => Promise<boolean>
        getSetupCommands: () => Promise<McpSetupCommands>
        copySetupCommand: (command: string) => Promise<void>
        onStatusChanged: (listener: (status: McpStatus) => void) => () => void
        onDeckUpdated: (listener: (update: ExternalDeckUpdate) => void) => () => void
        onInteractionChanged: (listener: (change: McpInteractionChanged) => void) => () => void
      }
      updates: {
        check: () => Promise<DesktopResult>
      }
      files: {
        openWorkspace: () => Promise<string | null>
        chooseWorkspacePath: (suggestedName: string) => Promise<string | null>
        chooseDirectory: () => Promise<string | null>
        reveal: (path: string) => Promise<void>
      }
    }
  }
}

export {}
