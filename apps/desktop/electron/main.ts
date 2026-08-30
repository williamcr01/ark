import { createServer, type RequestListener, type Server } from 'node:http'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import express from 'express'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
  type WebContents,
} from 'electron'
import electronUpdater from 'electron-updater'
import {
  isValidDeckId,
  mcpInteractionAnswerSchema,
  type ExternalDeckUpdate,
  type McpActivityEvent,
  type McpInteractionChanged,
  type McpStatus,
  type ProviderId,
} from '@ark/contracts'
import { mcpDiscoveryPath } from '@ark/mcp-server/discovery.ts'
import { runMcpBridge } from '@ark/mcp-server/bridge.ts'

import { SecureCredentialStore } from './credential-store.ts'
import { getRendererContentSecurityPolicy } from './renderer-security.ts'
import { DesktopSettingsStore } from './settings-store.ts'
import { createElectronThumbnailRenderer } from './thumbnail-renderer.ts'
import { McpManager, resolveMcpExecutableArgs } from './mcp-manager.ts'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const { autoUpdater } = electronUpdater
const providers = new Set<ProviderId>(['openai', 'anthropic', 'google'])
const rendererDevelopmentUrl = process.env.ARK_DESKTOP_RENDERER_URL?.trim() || null
const desktopSmoke = process.env.ARK_DESKTOP_SMOKE === '1'
const smokeDataDirectory = desktopSmoke
  ? path.join(app.getPath('temp'), `ark-desktop-smoke-${process.pid}`)
  : null

type DeferredServer = {
  server: Server
  origin: string
  setHandler: (handler: RequestListener) => void
}

function listen(port: number): Promise<DeferredServer> {
  let handler: RequestListener = (_request, response) => {
    response.statusCode = 503
    response.end('Ark is starting.')
  }
  const server = createServer((request, response) => handler(request, response))

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Could not resolve the Ark loopback server address.'))
        return
      }

      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
        setHandler(nextHandler) {
          handler = nextHandler
        },
      })
    })
  })
}

function closeServer(server: Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()))
}

function hasAllowedOrigin(rawUrl: string, allowedOrigins: ReadonlySet<string>) {
  try {
    const url = new URL(rawUrl)
    return allowedOrigins.has(url.origin)
  } catch {
    return false
  }
}

function lockRendererNetwork(webContents: WebContents, rendererOrigin: string) {
  const allowedOrigins = new Set([rendererOrigin])
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // This event covers the main renderer frame only. Subframe requests and navigations are
  // intentionally enforced by the session-wide webRequest filter below; keep both layers.
  webContents.on('will-navigate', (event, url) => {
    if (!hasAllowedOrigin(url, allowedOrigins)) event.preventDefault()
  })
  webContents.on('will-attach-webview', (event) => event.preventDefault())
}

function configureSessionSecurity(allowedOrigins: ReadonlySet<string>) {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const url = new URL(details.url)
      const allowed =
        ['data:', 'blob:', 'devtools:'].includes(url.protocol) ||
        (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) &&
          allowedOrigins.has(url.origin.replace(/^ws/, 'http')))
      callback({ cancel: !allowed })
    } catch {
      callback({ cancel: true })
    }
  })
}

function parseProvider(value: unknown): ProviderId {
  if (typeof value !== 'string' || !providers.has(value as ProviderId)) {
    throw new Error('Unsupported provider.')
  }
  return value as ProviderId
}

// Electron installs a default File/Edit/View/Window menu whenever an app never sets
// one. Ark's chrome lives in the renderer title bar, so that menu is dead weight.
//
// macOS keeps a two-item template rather than no menu at all: the system draws a menu
// bar for the frontmost app either way, and the standard roles are what bind Cmd+Q and
// the clipboard shortcuts. Dropping them there would leave copy/paste broken inside the
// composer, so only File/View/Window/Help go away on that platform.
function configureApplicationMenu() {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]))
    return
  }
  Menu.setApplicationMenu(null)
}

async function startDesktop() {
  configureApplicationMenu()

  const developmentApiPort = rendererDevelopmentUrl ? Number(process.env.PORT?.trim() || 8787) : 0
  const developmentSandboxPort = rendererDevelopmentUrl
    ? Number(process.env.SANDBOX_PORT?.trim() || 5174)
    : 0
  const [apiServer, sandboxServer] = await Promise.all([
    listen(developmentApiPort),
    listen(developmentSandboxPort),
  ])
  const appOrigin = rendererDevelopmentUrl ?? apiServer.origin

  process.env.ARK_API_ORIGIN = apiServer.origin
  process.env.ARK_APP_ORIGIN = appOrigin
  process.env.ARK_SANDBOX_ORIGIN = sandboxServer.origin
  process.env.PORT = new URL(apiServer.origin).port
  process.env.SANDBOX_PORT = new URL(sandboxServer.origin).port
  process.env.ARK_DATA_DIR = app.getPath('userData')
  process.env.ARK_WORKSPACES_DIR = path.join(app.getPath('documents'), 'Ark')

  const resourceRoot = app.isPackaged
    ? process.resourcesPath
    : path.resolve(app.getAppPath(), '../..')
  process.env.ARK_RUNTIMES_DIR = path.join(resourceRoot, 'runtimes')
  process.env.ARK_AGENT_GUIDES_DIR = path.join(resourceRoot, 'agent-guides')
  process.env.ARK_MCP_GUIDES_DIR = path.join(resourceRoot, 'mcp-guides')
  const [
    { createApp },
    { createSandboxHost },
    { createPreviewSessionStore },
    { createThumbnailRenderSecret },
    { createMcpServiceState },
    { createMcpInteractionStore },
    { setProviderApiKeySource },
    { clearModelCatalogCache, testProviderApiKey, warmModelCatalog },
  ] = await Promise.all([
    import('@ark/api/app.ts'),
    import('@ark/sandbox/sandbox-host.ts'),
    import('@ark/storage/stores/preview-sessions.ts'),
    import('@ark/api/thumbnails/render-host.ts'),
    import('@ark/api/mcp-service.ts'),
    import('@ark/api/mcp-interactions.ts'),
    import('@ark/ai/credentials.ts'),
    import('@ark/ai/models.ts'),
  ])

  const credentialStore = new SecureCredentialStore(path.join(app.getPath('userData'), 'auth.json'))
  const settingsStore = new DesktopSettingsStore(
    path.join(app.getPath('userData'), 'settings.json'),
  )
  await Promise.all([credentialStore.load(), settingsStore.load()])
  process.env.ARK_WORKSPACES_DIR =
    settingsStore.get().defaultWorkspaceDirectory || process.env.ARK_WORKSPACES_DIR
  setProviderApiKeySource(credentialStore)
  void warmModelCatalog()

  const previewSessionStore = createPreviewSessionStore()
  const mcpServiceState = createMcpServiceState()
  const thumbnailRenderSecret = createThumbnailRenderSecret()
  const thumbnailRenderer = createElectronThumbnailRenderer({
    apiOrigin: apiServer.origin,
    previewSessionStore,
    renderSecret: thumbnailRenderSecret,
  })
  let window: BrowserWindow | null = null
  let mcpManager: McpManager | null = null
  const sendToRenderer = (
    channel: string,
    value: McpStatus | ExternalDeckUpdate | McpActivityEvent | McpInteractionChanged,
  ) => {
    const target = window
    if (target && !target.isDestroyed()) target.webContents.send(channel, value)
  }
  const mcpInteractionStore = createMcpInteractionStore((change) =>
    sendToRenderer('mcp:interaction-changed', change),
  )
  const api = createApp({
    previewSessionStore,
    thumbnailRenderer,
    thumbnailRenderSecret,
    mcpServiceState,
    mcpInteractionStore,
    onExternalDeckUpdate: (update) => mcpManager?.recordExternalUpdate(update),
    onMcpActivity: (activity) => mcpManager?.recordActivity(activity),
  })
  mcpManager = new McpManager({
    apiOrigin: apiServer.origin,
    userDataDirectory: app.getPath('userData'),
    serviceState: mcpServiceState,
    interactionStore: mcpInteractionStore,
    getAutoStart: () => settingsStore.get().mcpAutoStart,
    setAutoStart: async (enabled) => {
      await settingsStore.update({ mcpAutoStart: enabled })
    },
    executableArgs: resolveMcpExecutableArgs({
      isPackaged: app.isPackaged,
      execPath: process.execPath,
      appPath: app.getAppPath(),
      platform: process.platform,
      ...(process.env.APPIMAGE ? { appImagePath: process.env.APPIMAGE } : {}),
    }),
    onStatusChanged: (status) => sendToRenderer('mcp:status-changed', status),
    onDeckUpdated: (update) => sendToRenderer('mcp:deck-updated', update),
  })
  await mcpManager.cleanupStartup()
  const rendererDirectory = path.resolve(dirname, '../renderer')

  api.use((request, response, next) => {
    if (request.path.startsWith('/api/')) {
      response.status(404).json({ error: 'API route not found.' })
      return
    }

    response.setHeader(
      'Content-Security-Policy',
      getRendererContentSecurityPolicy(sandboxServer.origin),
    )
    next()
  })
  api.use(express.static(rendererDirectory, { index: 'index.html' }))
  api.use((_request, response) => response.sendFile(path.join(rendererDirectory, 'index.html')))
  apiServer.setHandler(api)

  if (settingsStore.get().mcpAutoStart) await mcpManager.start()

  const sandbox = createSandboxHost({
    apiOrigin: apiServer.origin,
    previewSessionStore,
  })
  sandboxServer.setHandler(sandbox)

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
  ipcMain.handle('mcp:get-status', () => mcpManager!.getStatus())
  ipcMain.handle('mcp:start', () => mcpManager!.start())
  ipcMain.handle('mcp:stop', () => mcpManager!.stop())
  ipcMain.handle('mcp:set-auto-start', (_event, enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid MCP autostart preference.')
    return mcpManager!.setAutoStart(enabled)
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
    mcpManager!.setActiveDeck(
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
  ipcMain.handle('mcp:get-setup-commands', () => mcpManager!.getSetupCommands())
  ipcMain.handle('mcp:copy-setup-command', (_event, command) => {
    if (
      typeof command !== 'string' ||
      !Object.values(mcpManager!.getSetupCommands()).includes(command)
    ) {
      throw new Error('Invalid MCP setup command.')
    }
    clipboard.writeText(command)
  })
  ipcMain.handle('files:open-workspace', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Ark Workspace', extensions: ['ark'] }],
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

  configureSessionSecurity(new Set([appOrigin, apiServer.origin, sandboxServer.origin]))
  window = new BrowserWindow({
    title: 'Ark',
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#101010',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.resolve(dirname, '../preload/preload.cjs'),
      sandbox: true,
      webSecurity: true,
    },
  })
  lockRendererNetwork(window.webContents, appOrigin)
  window.once('ready-to-show', () => window.show())
  window.once('closed', () => app.quit())
  await window.loadURL(rendererDevelopmentUrl ?? apiServer.origin)

  if (app.isPackaged && !desktopSmoke) {
    void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined)
  }

  let closing = false
  app.on('before-quit', (event) => {
    if (closing) return
    event.preventDefault()
    closing = true
    const thumbnailService = api.locals.thumbnailService as
      { close: () => Promise<void> } | undefined
    const workspaceStore = api.locals.workspaceStore as { close: () => void } | undefined
    void Promise.all([
      mcpManager?.stop() ?? Promise.resolve(),
      thumbnailService?.close() ?? Promise.resolve(),
      closeServer(apiServer.server),
      closeServer(sandboxServer.server),
    ])
      .then(() => workspaceStore?.close())
      .then(() =>
        smokeDataDirectory
          ? rm(smokeDataDirectory, { recursive: true, force: true })
          : Promise.resolve(),
      )
      .finally(() => app.quit())
  })

  if (desktopSmoke) {
    try {
      const rendererReady = (await window.webContents.executeJavaScript(
        `Boolean(document.getElementById('root')) &&
          typeof window.arkDesktop?.credentials?.list === 'function'`,
        true,
      )) as boolean
      const [healthResponse, sandboxHealthResponse] = await Promise.all([
        fetch(`${apiServer.origin}/api/health`),
        fetch(`${sandboxServer.origin}/health`),
      ])
      const thumbnail = await thumbnailRenderer.render({
        html: '<!doctype html><html><head><style>html,body{margin:0}section{width:100vw;height:100vh;background:#123;color:white}</style></head><body><section class="slide"><h1>Ark desktop smoke</h1></section></body></html>',
      })

      if (
        !rendererReady ||
        !healthResponse.ok ||
        !sandboxHealthResponse.ok ||
        !thumbnail.ok ||
        thumbnail.slides[0]?.subarray(1, 4).toString('ascii') !== 'PNG'
      ) {
        throw new Error('Desktop smoke validation failed.')
      }

      console.log('ARK_DESKTOP_SMOKE_OK')
      app.quit()
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  }

  return window
}

app.setName('Ark')
if (smokeDataDirectory) app.setPath('userData', smokeDataDirectory)
const mcpMode = process.argv.includes('--mcp')
const hasSingleInstanceLock = mcpMode ? false : app.requestSingleInstanceLock()

if (mcpMode) {
  runMcpBridge(mcpDiscoveryPath(app.getPath('userData')))
} else if (!hasSingleInstanceLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  app.on('window-all-closed', () => app.quit())

  void app
    .whenReady()
    .then(async () => {
      mainWindow = await startDesktop()
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
