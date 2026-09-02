/**
 * Electron main-process code: no DOM.
 *
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { getFocusedWindow: vi.fn() },
  clipboard: { writeText: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler)
    }),
    on: vi.fn(),
  },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  shell: { showItemInFolder: vi.fn() },
}))

vi.mock('electron-updater', () => ({
  default: { autoUpdater: { checkForUpdatesAndNotify: vi.fn() } },
}))

const { registerIpcHandlers } = await import('./ipc.ts')

describe('credential IPC catalog invalidation', () => {
  afterEach(() => {
    ipcHandlers.clear()
    vi.clearAllMocks()
  })

  function register(overrides?: {
    set?: ReturnType<typeof vi.fn>
    setSession?: ReturnType<typeof vi.fn>
    remove?: ReturnType<typeof vi.fn>
  }) {
    const credentialStore = {
      set: overrides?.set ?? vi.fn(async () => undefined),
      setSession: overrides?.setSession ?? vi.fn(),
      remove: overrides?.remove ?? vi.fn(async () => undefined),
      getStatus: vi.fn(() => ({})),
    }
    const clearModelCatalogCache = vi.fn()
    const warmModelCatalog = vi.fn(async () => undefined)

    registerIpcHandlers({
      credentialStore: credentialStore as never,
      settingsStore: { get: () => ({}), update: vi.fn() } as never,
      mcpInteractionStore: {} as never,
      api: {} as never,
      getMcpManager: () => ({}) as never,
      clearModelCatalogCache,
      warmModelCatalog,
      testProviderApiKey: vi.fn(async () => ({ modelCount: 1 })),
      generateDeckExport: vi.fn(),
    })

    return { credentialStore, clearModelCatalogCache, warmModelCatalog }
  }

  it('invalidates the model catalog when an openrouter key is set or removed', async () => {
    const { credentialStore, clearModelCatalogCache, warmModelCatalog } = register()

    const save = ipcHandlers.get('credentials:save')
    const saveSession = ipcHandlers.get('credentials:save-session')
    const remove = ipcHandlers.get('credentials:remove')
    expect(save).toBeTypeOf('function')
    expect(saveSession).toBeTypeOf('function')
    expect(remove).toBeTypeOf('function')

    await expect(save!({}, 'openrouter', 'or-secret')).resolves.toEqual({ ok: true })
    expect(credentialStore.set).toHaveBeenCalledWith('openrouter', 'or-secret')
    expect(clearModelCatalogCache).toHaveBeenCalledTimes(1)
    expect(warmModelCatalog).toHaveBeenCalledTimes(1)

    expect(saveSession!({}, 'openrouter', 'or-session')).toEqual({ ok: true })
    expect(credentialStore.setSession).toHaveBeenCalledWith('openrouter', 'or-session')
    expect(clearModelCatalogCache).toHaveBeenCalledTimes(2)

    await expect(remove!({}, 'openrouter')).resolves.toEqual({ ok: true })
    expect(credentialStore.remove).toHaveBeenCalledWith('openrouter')
    expect(clearModelCatalogCache).toHaveBeenCalledTimes(3)
  })

  it('rejects unknown provider ids without touching the catalog cache', async () => {
    const { credentialStore, clearModelCatalogCache } = register()
    const save = ipcHandlers.get('credentials:save')

    await expect(save!({}, 'azure', 'sk-secret')).resolves.toEqual({
      ok: false,
      error: 'Unsupported provider.',
    })
    expect(credentialStore.set).not.toHaveBeenCalled()
    expect(clearModelCatalogCache).not.toHaveBeenCalled()
  })
})
