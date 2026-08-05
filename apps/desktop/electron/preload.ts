import { contextBridge, ipcRenderer } from 'electron'
import type { ProviderId } from '@ark/contracts'

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
  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
  },
  files: {
    openWorkspace: () => ipcRenderer.invoke('files:open-workspace'),
    chooseWorkspacePath: (suggestedName: string) =>
      ipcRenderer.invoke('files:choose-workspace-path', suggestedName),
    chooseDirectory: () => ipcRenderer.invoke('files:choose-directory'),
    reveal: (path: string) => ipcRenderer.invoke('files:reveal', path),
  },
})
