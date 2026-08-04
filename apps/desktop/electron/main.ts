import { createServer, type RequestListener, type Server } from 'node:http'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import express from 'express'
import { app, BrowserWindow, dialog, ipcMain, session, shell, type WebContents } from 'electron'
import electronUpdater from 'electron-updater'
import type { ProviderId } from '@ark/contracts'

import { SecureCredentialStore } from './credential-store.ts'
import { getRendererContentSecurityPolicy } from './renderer-security.ts'
import { DesktopSettingsStore } from './settings-store.ts'
import { createElectronThumbnailRenderer } from './thumbnail-renderer.ts'

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

async function startDesktop() {
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
  const [
    { createApp },
    { createSandboxHost },
    { createPreviewSessionStore },
    { createThumbnailRenderSecret },
    { setProviderApiKeySource },
    { clearModelCatalogCache, testProviderApiKey, warmModelCatalog },
  ] = await Promise.all([
    import('@ark/api/app.ts'),
    import('@ark/sandbox/sandbox-host.ts'),
    import('@ark/api/preview-sessions.ts'),
    import('@ark/api/thumbnails/render-host.ts'),
    import('@ark/api/credentials.ts'),
    import('@ark/api/models.ts'),
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
  const thumbnailRenderSecret = createThumbnailRenderSecret()
  const thumbnailRenderer = createElectronThumbnailRenderer({
    apiOrigin: apiServer.origin,
    previewSessionStore,
    renderSecret: thumbnailRenderSecret,
  })
  const api = createApp({
    previewSessionStore,
    thumbnailRenderer,
    thumbnailRenderSecret,
  })
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
  ipcMain.handle('files:open-workspace', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Ark Workspace', extensions: ['ark'] }],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('files:choose-workspace-path', async (_event, suggestedName) => {
    const result = await dialog.showSaveDialog({
      defaultPath: path.join(
        settingsStore.get().defaultWorkspaceDirectory || path.join(app.getPath('documents'), 'Ark'),
        typeof suggestedName === 'string' ? suggestedName : 'Untitled Presentation.ark',
      ),
      filters: [{ name: 'Ark Workspace', extensions: ['ark'] }],
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
  const window = new BrowserWindow({
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
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
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
