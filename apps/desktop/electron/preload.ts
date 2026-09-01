import { contextBridge, ipcRenderer } from 'electron'
import type {
  ExternalDeckUpdate,
  McpInteractionAnswer,
  McpInteractionChanged,
  McpPendingInteraction,
  McpStatus,
  ProviderId,
} from '@ark/contracts'

const subscribe = <T>(channel: string, listener: (value: T) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('arkDesktop', {
  credentials: {
    list: () => ipcRenderer.invoke('credentials:list'),
    save: (provider: ProviderId, apiKey: string) =>
      ipcRenderer.invoke('credentials:save', provider, apiKey),
    saveSession: (provider: ProviderId, apiKey: string) =>
      ipcRenderer.invoke('credentials:save-session', provider, apiKey),
    remove: (provider: ProviderId) => ipcRenderer.invoke('credentials:remove', provider),
    test: (provider: ProviderId, apiKey: string) =>
      ipcRenderer.invoke('credentials:test', provider, apiKey),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch: unknown) => ipcRenderer.invoke('settings:update', patch),
  },
  mcp: {
    getStatus: () => ipcRenderer.invoke('mcp:get-status'),
    start: () => ipcRenderer.invoke('mcp:start'),
    stop: () => ipcRenderer.invoke('mcp:stop'),
    setAutoStart: (enabled: boolean) => ipcRenderer.invoke('mcp:set-auto-start', enabled),
    setActiveDeck: (deckId: string | null, title: string | null, documentRevision: number | null) =>
      ipcRenderer.invoke('mcp:set-active-deck', deckId, title, documentRevision),
    getPendingInteraction: (): Promise<McpPendingInteraction | null> =>
      ipcRenderer.invoke('mcp:get-pending-interaction'),
    respondToInteraction: (id: string, answer: McpInteractionAnswer) =>
      ipcRenderer.invoke('mcp:respond-interaction', id, answer),
    cancelInteraction: (id: string) => ipcRenderer.invoke('mcp:cancel-interaction', id),
    getSetupCommands: () => ipcRenderer.invoke('mcp:get-setup-commands'),
    copySetupCommand: (command: string) => ipcRenderer.invoke('mcp:copy-setup-command', command),
    onStatusChanged: (listener: (status: McpStatus) => void) =>
      subscribe('mcp:status-changed', listener),
    onDeckUpdated: (listener: (update: ExternalDeckUpdate) => void) =>
      subscribe('mcp:deck-updated', listener),
    onInteractionChanged: (listener: (change: McpInteractionChanged) => void) =>
      subscribe('mcp:interaction-changed', listener),
  },
  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
  },
  export: {
    create: (request: { format: 'pdf' | 'pptx'; html: string; title: string }) =>
      ipcRenderer.invoke('export:create', request),
  },
  files: {
    openWorkspace: () => ipcRenderer.invoke('files:open-workspace'),
    chooseWorkspacePath: (suggestedName: string, defaultPath?: string) =>
      ipcRenderer.invoke('files:choose-workspace-path', suggestedName, defaultPath),
    chooseDirectory: () => ipcRenderer.invoke('files:choose-directory'),
    reveal: (path: string) => ipcRenderer.invoke('files:reveal', path),
  },
  edit: {
    setHistoryState: (state: { canUndo: boolean; canRedo: boolean }) =>
      ipcRenderer.send('edit:history-state', state),
    onHistoryAction: (listener: (action: 'undo' | 'redo') => void) =>
      subscribe('edit:history-action', listener),
  },
})
