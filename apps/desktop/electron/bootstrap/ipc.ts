/**
 * Every `ipcMain` channel the renderer can call. The preload bridge is deliberately narrow:
 * credentials, settings, MCP control, file dialogs, update checks, and session undo menu
 * state — nothing else.
 */

import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { app, clipboard, dialog, ipcMain, shell } from 'electron'
import electronUpdater from 'electron-updater'

import {
  isValidDeckId,
  mcpClientIdSchema,
  mcpInteractionAnswerSchema,
  providerIdSchema,
  type ProviderId,
} from '@ark/contracts'
import type { Express } from 'express'

import type { McpInteractionStore } from '@ark/mcp/interactions.ts'

import type { SecureCredentialStore } from '../credential-store.ts'
import type { DesktopSettingsStore } from '../settings-store.ts'
import type { McpManager } from '../mcp-manager.ts'
import type { DeckExportRequest, DeckExportResult } from '../deck-export.ts'
import {
  exportDialogFilter,
  exportFileName,
  parseDeckExportRequest,
} from '../deck-export-request.ts'
import { setEditHistoryMenuState } from './menu.ts'

const { autoUpdater } = electronUpdater
function parseProvider(value: unknown): ProviderId {
  const parsed = providerIdSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error('Unsupported provider.')
  }
  return parsed.data
}
export type IpcDependencies = {
  credentialStore: SecureCredentialStore
  settingsStore: DesktopSettingsStore
  mcpInteractionStore: McpInteractionStore
  api: Express
  /** Resolved lazily: the manager is constructed after the handlers are registered. */
  getMcpManager: () => McpManager
  clearModelCatalogCache: () => void
  warmModelCatalog: () => Promise<unknown>
  testProviderApiKey: (provider: ProviderId, apiKey: string) => Promise<{ modelCount: number }>
  generateDeckExport: (request: DeckExportRequest) => Promise<DeckExportResult>
}

function registerCredentialIpc(deps: IpcDependencies) {
  const { credentialStore, clearModelCatalogCache, warmModelCatalog, testProviderApiKey } = deps
  ipcMain.handle('credentials:list', () => credentialStore.getStatus())
  ipcMain.handle('credentials:save', async (_event, rawProvider, rawApiKey) => {
    try {
      const provider = parseProvider(rawProvider)
      if (typeof rawApiKey !== 'string' || rawApiKey.length > 16_384) {
        throw new Error('Invalid API key.')
      }
      await credentialStore.set(provider, rawApiKey)
      clearModelCatalogCache()
      void warmModelCatalog()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not save key.' }
    }
  })
  ipcMain.handle('credentials:save-session', (_event, rawProvider, rawApiKey) => {
    try {
      const provider = parseProvider(rawProvider)
      if (typeof rawApiKey !== 'string' || rawApiKey.length > 16_384) {
        throw new Error('Invalid API key.')
      }
      credentialStore.setSession(provider, rawApiKey)
      clearModelCatalogCache()
      void warmModelCatalog()
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not use key for this session.',
      }
    }
  })
  ipcMain.handle('credentials:remove', async (_event, rawProvider) => {
    try {
      await credentialStore.remove(parseProvider(rawProvider))
      clearModelCatalogCache()
      void warmModelCatalog()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not remove key.' }
    }
  })
  ipcMain.handle('credentials:test', async (_event, rawProvider, rawApiKey) => {
    try {
      const provider = parseProvider(rawProvider)
      if (typeof rawApiKey !== 'string' || !rawApiKey.trim() || rawApiKey.length > 16_384) {
        throw new Error('API key is required.')
      }
      const result = await testProviderApiKey(provider, rawApiKey)
      return { ok: true, modelCount: result.modelCount }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not test key.' }
    }
  })
}

function registerSettingsIpc(deps: IpcDependencies) {
  const { settingsStore, api } = deps
  ipcMain.handle('settings:get', () => settingsStore.get())
  ipcMain.handle('settings:update', async (_event, patch) => {
    const settings = await settingsStore.update(patch)
    const workspaceStore = api.locals.workspaceStore as
      { setDefaultDirectory: (directory: string) => void } | undefined
    if (settings.defaultWorkspaceDirectory) {
      workspaceStore?.setDefaultDirectory(settings.defaultWorkspaceDirectory)
    }
    return settings
  })
}

function registerMcpIpc(deps: IpcDependencies) {
  const { getMcpManager, mcpInteractionStore } = deps
  ipcMain.handle('mcp:get-status', () => getMcpManager().getStatus())
  ipcMain.handle('mcp:start', () => getMcpManager().start())
  ipcMain.handle('mcp:stop', () => getMcpManager().stop())
  ipcMain.handle('mcp:set-auto-start', (_event, enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid MCP autostart preference.')
    return getMcpManager().setAutoStart(enabled)
  })
  ipcMain.handle('mcp:set-active-deck', (_event, deckId, title, documentRevision) => {
    if (deckId !== null && (typeof deckId !== 'string' || !isValidDeckId(deckId))) {
      throw new Error('Invalid active deck id.')
    }
    if (
      documentRevision !== null &&
      (!Number.isInteger(documentRevision) || documentRevision < 1)
    ) {
      throw new Error('Invalid document revision.')
    }
    getMcpManager().setActiveDeck(
      deckId,
      deckId && typeof title === 'string' ? title.slice(0, 1_000) : null,
      deckId ? documentRevision : null,
    )
  })
  ipcMain.handle('mcp:get-pending-interaction', () => mcpInteractionStore.getPending())
  ipcMain.handle('mcp:respond-interaction', (_event, id, rawAnswer) => {
    if (typeof id !== 'string') throw new Error('Invalid interaction id.')
    const answer = mcpInteractionAnswerSchema.parse(rawAnswer)
    mcpInteractionStore.respond(id, answer)
  })
  ipcMain.handle('mcp:cancel-interaction', (_event, id) => {
    if (typeof id !== 'string') throw new Error('Invalid interaction id.')
    return mcpInteractionStore.cancel(id)
  })
  ipcMain.handle('mcp:get-setup-commands', () => getMcpManager().getSetupCommands())
  ipcMain.handle('mcp:get-client-installations', () => getMcpManager().getClientInstallations())
  ipcMain.handle('mcp:add-client', (_event, clientId) =>
    getMcpManager().addClient(mcpClientIdSchema.parse(clientId)),
  )
  ipcMain.handle('mcp:remove-client', (_event, clientId) =>
    getMcpManager().removeClient(mcpClientIdSchema.parse(clientId)),
  )
  ipcMain.handle('mcp:update-client', (_event, clientId) =>
    getMcpManager().updateClient(mcpClientIdSchema.parse(clientId)),
  )
  ipcMain.handle('mcp:copy-setup-command', (_event, command) => {
    if (
      typeof command !== 'string' ||
      !Object.values(getMcpManager().getSetupCommands()).includes(command)
    ) {
      throw new Error('Invalid MCP setup command.')
    }
    clipboard.writeText(command)
  })
}

function registerFilesIpc(deps: IpcDependencies) {
  const { settingsStore } = deps
  ipcMain.handle('files:open-workspace', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Ark and PowerPoint', extensions: ['ark', 'pptx', 'ppt'] },
        { name: 'Ark Workspace', extensions: ['ark'] },
        { name: 'PowerPoint', extensions: ['pptx', 'ppt'] },
      ],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('files:choose-workspace-path', async (_event, suggestedName, defaultPath) => {
    const result = await dialog.showSaveDialog({
      // A previously chosen (conflicting) path reopens the dialog in the same
      // location so the user can pick a different name. Otherwise default to
      // the workspace directory with the deck-title-derived name.
      defaultPath:
        typeof defaultPath === 'string' && defaultPath
          ? defaultPath
          : path.join(
              settingsStore.get().defaultWorkspaceDirectory ||
                path.join(app.getPath('documents'), 'Ark'),
              typeof suggestedName === 'string' ? suggestedName : 'Untitled Presentation.ark',
            ),
      filters: [{ name: 'Ark Workspace', extensions: ['ark'] }],
      // Ark owns the overwrite decision and asks before replacing. Omitting
      // 'showOverwriteConfirmation' turns off the GTK prompt (on by default on
      // Linux) so the user is not prompted twice.
      properties: [],
    })
    return result.canceled ? null : (result.filePath ?? null)
  })
  ipcMain.handle('files:choose-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('files:reveal', (_event, filePath) => {
    if (typeof filePath === 'string') shell.showItemInFolder(filePath)
  })
}

function registerExportIpc(deps: IpcDependencies) {
  const { settingsStore, generateDeckExport } = deps
  ipcMain.handle('export:create', async (event, rawRequest) => {
    try {
      const request = parseDeckExportRequest(rawRequest)
      const result = await dialog.showSaveDialog({
        defaultPath: path.join(
          settingsStore.get().defaultWorkspaceDirectory || app.getPath('documents'),
          exportFileName(request.title, request.format),
        ),
        filters: [exportDialogFilter(request.format)],
      })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }

      // Render before touching disk: a failed export must not leave a truncated
      // or empty file where the user asked for their deck.
      const controller = new AbortController()
      const abort = () => controller.abort()
      event.sender.once('destroyed', abort)
      try {
        const { output, warning } = await generateDeckExport({
          ...request,
          signal: controller.signal,
        })
        await writeFile(result.filePath, output)
        return { ok: true, path: result.filePath, warning }
      } finally {
        event.sender.removeListener('destroyed', abort)
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not export deck.',
      }
    }
  })
  ipcMain.on('edit:history-state', (event, state) => {
    if (
      !state ||
      typeof state !== 'object' ||
      typeof state.canUndo !== 'boolean' ||
      typeof state.canRedo !== 'boolean'
    ) {
      return
    }
    setEditHistoryMenuState({ canUndo: state.canUndo, canRedo: state.canRedo }, event.sender)
  })
  ipcMain.handle('updates:check', async () => {
    if (!app.isPackaged)
      return { ok: false, error: 'Updates are only available in packaged builds.' }
    try {
      await autoUpdater.checkForUpdatesAndNotify()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Update check failed.' }
    }
  })
}

export function registerIpcHandlers(deps: IpcDependencies) {
  registerCredentialIpc(deps)
  registerSettingsIpc(deps)
  registerMcpIpc(deps)
  registerFilesIpc(deps)
  registerExportIpc(deps)
}
