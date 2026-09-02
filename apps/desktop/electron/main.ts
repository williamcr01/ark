import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import express, { type Express } from 'express'
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
import { inspectExportedPptx } from './deck-pptx.ts'
import { McpManager, resolveMcpExecutableArgs } from './mcp-manager.ts'
import { registerIpcHandlers } from './bootstrap/ipc.ts'
import { configureApplicationMenu } from './bootstrap/menu.ts'
import { configureSessionSecurity, lockRendererNetwork } from './bootstrap/security.ts'
import { closeServer, listen } from './bootstrap/servers.ts'
import { resolveDesktopWorkspacesDir } from './workspaces-dir.ts'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const { autoUpdater } = electronUpdater
const rendererDevelopmentUrl = process.env.ARK_DESKTOP_RENDERER_URL?.trim() || null
const desktopSmoke = process.env.ARK_DESKTOP_SMOKE === '1'
const smokeDataDirectory = desktopSmoke
  ? path.join(app.getPath('temp'), `ark-desktop-smoke-${process.pid}`)
  : null

async function runDesktopSmoke(input: {
  window: BrowserWindow
  apiServerOrigin: string
  sandboxServerOrigin: string
  thumbnailRenderer: ReturnType<typeof createElectronThumbnailRenderer>
  generateDeckExport: ReturnType<typeof createDeckExportGenerator>
  deckRenderConfig: {
    apiOrigin: string
    previewSessionStore: ReturnType<
      typeof import('@ark/storage/stores/preview-sessions.ts').createPreviewSessionStore
    >
    renderSecret: string
  }
}) {
  const {
    window,
    apiServerOrigin,
    sandboxServerOrigin,
    thumbnailRenderer,
    generateDeckExport,
    deckRenderConfig,
  } = input
  const rendererReady = (await window.webContents.executeJavaScript(
    `Boolean(document.getElementById('root')) &&
          typeof window.arkDesktop?.credentials?.list === 'function'`,
    true,
  )) as boolean
  const [healthResponse, sandboxHealthResponse] = await Promise.all([
    fetch(`${apiServerOrigin}/api/health`),
    fetch(`${sandboxServerOrigin}/health`),
  ])
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
  const exportedPdf = await generateDeckExport({
    format: 'pdf',
    html: smokeDeckHtml,
    title: 'Ark desktop smoke',
  })
  const exportReport = await inspectExportedPdf(exportedPdf.output)
  const exportedPptx = await generateDeckExport({
    format: 'pptx',
    html: smokeDeckHtml,
    title: 'Ark desktop smoke',
  })
  const pptxReport = await inspectExportedPptx(exportedPptx.output)
  const scene = await extractDeckScene(deckRenderConfig, { html: smokeDeckHtml })
  const sceneReport = inspectExtractedScene(scene)

  if (
    !rendererReady ||
    !healthResponse.ok ||
    !sandboxHealthResponse.ok ||
    !thumbnail.ok ||
    thumbnail.slides[0]?.subarray(1, 4).toString('ascii') !== 'PNG' ||
    !exportReport.ok ||
    !sceneReport.ok ||
    !pptxReport.ok
  ) {
    throw new Error(
      `Desktop smoke validation failed. ${exportReport.detail} ${sceneReport.detail} ${pptxReport.detail}`.trim(),
    )
  }

  console.log('ARK_DESKTOP_SMOKE_OK')
  app.quit()
}

function openDesktopWindow(appOrigin: string, loadUrl: string) {
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
  return window.loadURL(loadUrl).then(() => window)
}

function wireDesktopBeforeQuit(
  api: Express,
  apiServer: { server: Parameters<typeof closeServer>[0] },
  sandboxServer: { server: Parameters<typeof closeServer>[0] },
  getMcpManager: () => McpManager | null,
) {
  let closing = false
  app.on('before-quit', (event) => {
    if (closing) return
    event.preventDefault()
    closing = true
    const thumbnailService = api.locals.thumbnailService as
      { close: () => Promise<void> } | undefined
    const workspaceStore = api.locals.workspaceStore as { close: () => void } | undefined
    void Promise.all([
      getMcpManager()?.stop() ?? Promise.resolve(),
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
}

function configureDesktopProcessEnv(apiOrigin: string, sandboxOrigin: string, appOrigin: string) {
  process.env.ARK_API_ORIGIN = apiOrigin
  process.env.ARK_APP_ORIGIN = appOrigin
  process.env.ARK_SANDBOX_ORIGIN = sandboxOrigin
  process.env.PORT = new URL(apiOrigin).port
  process.env.SANDBOX_PORT = new URL(sandboxOrigin).port
  process.env.ARK_DATA_DIR = app.getPath('userData')
  const workspacesDir = resolveDesktopWorkspacesDir({
    isPackaged: app.isPackaged,
    documentsArk: path.join(app.getPath('documents'), 'Ark'),
    env: process.env,
  })
  process.env.ARK_WORKSPACES_DIR = workspacesDir.directory
  const resourceRoot = app.isPackaged
    ? process.resourcesPath
    : path.resolve(app.getAppPath(), '../..')
  process.env.ARK_RUNTIMES_DIR = path.join(resourceRoot, 'runtimes')
  process.env.ARK_AGENT_GUIDES_DIR = path.join(resourceRoot, 'agent-guides')
  process.env.ARK_MCP_GUIDES_DIR = path.join(resourceRoot, 'mcp-guides')
  return workspacesDir
}

async function loadDesktopRuntimeModules() {
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
  return {
    createApp,
    createSandboxHost,
    createPreviewSessionStore,
    createThumbnailRenderSecret,
    createMcpServiceState,
    createMcpInteractionStore,
    setProviderApiKeySource,
    clearModelCatalogCache,
    testProviderApiKey,
    warmModelCatalog,
  }
}

function mountDesktopRenderer(api: Express, rendererDirectory: string, sandboxOrigin: string) {
  api.use((request, response, next) => {
    if (request.path.startsWith('/api/')) {
      response.status(404).json({ error: 'API route not found.' })
      return
    }

    response.setHeader('Content-Security-Policy', getRendererContentSecurityPolicy(sandboxOrigin))
    next()
  })
  api.use(express.static(rendererDirectory, { index: 'index.html' }))
  api.use((_request, response) => response.sendFile(path.join(rendererDirectory, 'index.html')))
}

function createDesktopMcpManager(input: {
  apiOrigin: string
  settingsStore: DesktopSettingsStore
  mcpServiceState: ReturnType<
    Awaited<ReturnType<typeof loadDesktopRuntimeModules>>['createMcpServiceState']
  >
  mcpInteractionStore: ReturnType<
    Awaited<ReturnType<typeof loadDesktopRuntimeModules>>['createMcpInteractionStore']
  >
  sendToRenderer: (
    channel: string,
    value: McpStatus | ExternalDeckUpdate | McpActivityEvent | McpInteractionChanged,
  ) => void
}) {
  return new McpManager({
    apiOrigin: input.apiOrigin,
    userDataDirectory: app.getPath('userData'),
    serviceState: input.mcpServiceState,
    interactionStore: input.mcpInteractionStore,
    getAutoStart: () => input.settingsStore.get().mcpAutoStart,
    setAutoStart: async (enabled) => {
      await input.settingsStore.update({ mcpAutoStart: enabled })
    },
    executableArgs: resolveMcpExecutableArgs({
      isPackaged: app.isPackaged,
      execPath: process.execPath,
      appPath: app.getAppPath(),
      platform: process.platform,
      ...(process.env.APPIMAGE ? { appImagePath: process.env.APPIMAGE } : {}),
    }),
    onStatusChanged: (status) => input.sendToRenderer('mcp:status-changed', status),
    onDeckUpdated: (update) => input.sendToRenderer('mcp:deck-updated', update),
  })
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
  const workspacesDir = configureDesktopProcessEnv(
    apiServer.origin,
    sandboxServer.origin,
    appOrigin,
  )
  const runtime = await loadDesktopRuntimeModules()

  const credentialStore = new SecureCredentialStore(path.join(app.getPath('userData'), 'auth.json'))
  const settingsStore = new DesktopSettingsStore(
    path.join(app.getPath('userData'), 'settings.json'),
  )
  await Promise.all([credentialStore.load(), settingsStore.load()])
  if (!workspacesDir.usedEnvOverride) {
    process.env.ARK_WORKSPACES_DIR =
      settingsStore.get().defaultWorkspaceDirectory || process.env.ARK_WORKSPACES_DIR
  }
  runtime.setProviderApiKeySource(credentialStore)
  void runtime.warmModelCatalog()

  const previewSessionStore = runtime.createPreviewSessionStore()
  const mcpServiceState = runtime.createMcpServiceState()
  const thumbnailRenderSecret = runtime.createThumbnailRenderSecret()
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
  const mcpInteractionStore = runtime.createMcpInteractionStore((change) =>
    sendToRenderer('mcp:interaction-changed', change),
  )
  const api = runtime.createApp({
    previewSessionStore,
    thumbnailRenderer,
    thumbnailRenderSecret,
    mcpServiceState,
    mcpInteractionStore,
    onExternalDeckUpdate: (update) => mcpManager?.recordExternalUpdate(update),
    onMcpActivity: (activity) => mcpManager?.recordActivity(activity),
  })
  mcpManager = createDesktopMcpManager({
    apiOrigin: apiServer.origin,
    settingsStore,
    mcpServiceState,
    mcpInteractionStore,
    sendToRenderer,
  })
  await mcpManager.cleanupStartup()
  mountDesktopRenderer(api, path.resolve(dirname, '../renderer'), sandboxServer.origin)
  apiServer.setHandler(api)

  if (settingsStore.get().mcpAutoStart) await mcpManager.start()

  sandboxServer.setHandler(
    runtime.createSandboxHost({
      apiOrigin: apiServer.origin,
      previewSessionStore,
    }),
  )

  registerIpcHandlers({
    credentialStore,
    settingsStore,
    mcpInteractionStore,
    api,
    getMcpManager: () => mcpManager!,
    clearModelCatalogCache: runtime.clearModelCatalogCache,
    warmModelCatalog: runtime.warmModelCatalog,
    testProviderApiKey: runtime.testProviderApiKey,
    generateDeckExport,
  })

  configureSessionSecurity(new Set([appOrigin, apiServer.origin, sandboxServer.origin]))
  window = await openDesktopWindow(appOrigin, rendererDevelopmentUrl ?? apiServer.origin)

  if (app.isPackaged && !desktopSmoke) {
    void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined)
  }

  wireDesktopBeforeQuit(api, apiServer, sandboxServer, () => mcpManager)

  if (desktopSmoke) {
    try {
      await runDesktopSmoke({
        window,
        apiServerOrigin: apiServer.origin,
        sandboxServerOrigin: sandboxServer.origin,
        thumbnailRenderer,
        generateDeckExport,
        deckRenderConfig,
      })
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
