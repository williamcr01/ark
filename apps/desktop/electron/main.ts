import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import express from 'express'
import { app, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import {
  type ExternalDeckUpdate,
  type McpActivityEvent,
  type McpInteractionChanged,
  type McpStatus,
} from '@ark/contracts'
import { mcpDiscoveryPath } from '@ark/mcp/discovery.ts'
import { runMcpBridge } from '@ark/mcp-server/bridge.ts'

import { SecureCredentialStore } from './credential-store.ts'
import { getRendererContentSecurityPolicy } from './renderer-security.ts'
import { DesktopSettingsStore } from './settings-store.ts'
import { createElectronThumbnailRenderer } from './thumbnail-renderer.ts'
import { createDeckExportGenerator, inspectExportedPdf } from './deck-export.ts'
import { extractDeckScene, inspectExtractedScene } from './deck-scene.ts'
import { McpManager, resolveMcpExecutableArgs } from './mcp-manager.ts'
import { registerIpcHandlers } from './bootstrap/ipc.ts'
import { configureApplicationMenu } from './bootstrap/menu.ts'
import { configureSessionSecurity, lockRendererNetwork } from './bootstrap/security.ts'
import { closeServer, listen } from './bootstrap/servers.ts'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const { autoUpdater } = electronUpdater
const rendererDevelopmentUrl = process.env.ARK_DESKTOP_RENDERER_URL?.trim() || null
const desktopSmoke = process.env.ARK_DESKTOP_SMOKE === '1'
const smokeDataDirectory = desktopSmoke
  ? path.join(app.getPath('temp'), `ark-desktop-smoke-${process.pid}`)
  : null

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
    import('@ark/mcp/service.ts'),
    import('@ark/mcp/interactions.ts'),
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
  const deckRenderConfig = {
    apiOrigin: apiServer.origin,
    previewSessionStore,
    renderSecret: thumbnailRenderSecret,
  }
  const thumbnailRenderer = createElectronThumbnailRenderer(deckRenderConfig)
  const generateDeckExport = createDeckExportGenerator(deckRenderConfig)
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

  registerIpcHandlers({
    credentialStore,
    settingsStore,
    mcpInteractionStore,
    api,
    getMcpManager: () => mcpManager!,
    clearModelCatalogCache,
    warmModelCatalog,
    testProviderApiKey,
    generateDeckExport,
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
      // Exercises the export paths that matter: prose, a bulleted list, and a
      // painted container, so the scene walk has text, bullets, and a shape.
      const smokeDeckHtml = [
        '<!doctype html><html lang="en" data-ark-font-body="calibri"><head><style>',
        'html,body{margin:0}',
        ':root{--ark-font-body:"Calibri","Carlito",sans-serif}',
        'section{width:100vw;height:100vh;background:#123;color:#fff;font-family:var(--ark-font-body)}',
        '.card{background:#2a3f55;border-radius:16px;padding:24px}',
        '</style></head><body>',
        '<section class="slide"><h1>Ark desktop smoke</h1><p>Exported from the render window.</p></section>',
        '<section class="slide"><div class="card"><h2>Second slide</h2><ul><li>First point</li><li>Second point</li></ul></div></section>',
        '</body></html>',
      ].join('')
      const thumbnail = await thumbnailRenderer.render({ html: smokeDeckHtml })
      const exported = await generateDeckExport({
        format: 'pdf',
        html: smokeDeckHtml,
        title: 'Ark desktop smoke',
      })
      const exportReport = await inspectExportedPdf(exported)
      const scene = await extractDeckScene(deckRenderConfig, { html: smokeDeckHtml })
      const sceneReport = inspectExtractedScene(scene)

      if (
        !rendererReady ||
        !healthResponse.ok ||
        !sandboxHealthResponse.ok ||
        !thumbnail.ok ||
        thumbnail.slides[0]?.subarray(1, 4).toString('ascii') !== 'PNG' ||
        !exportReport.ok ||
        !sceneReport.ok
      ) {
        throw new Error(
          `Desktop smoke validation failed. ${exportReport.detail} ${sceneReport.detail}`.trim(),
        )
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
