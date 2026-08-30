import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import { configureVitestRuntimeStylesheets } from '@ark/runtime-registry/runtime-stylesheet-disk.ts'
import { resetDesktopSettingsForTests } from '@/lib/ui/desktop-settings'
import { getTestLocalStorage, installTestLocalStorage } from './storage'

const isJsdomEnvironment = typeof HTMLElement !== 'undefined'

if (isJsdomEnvironment) {
  configureVitestRuntimeStylesheets()

  class TestResizeObserver {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }

  class TestIntersectionObserver {
    readonly root = null
    readonly rootMargin = '0px'
    readonly thresholds = [0]

    private callback: IntersectionObserverCallback

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback
    }

    observe = vi.fn((target: Element) => {
      this.callback(
        [
          {
            boundingClientRect: target.getBoundingClientRect(),
            intersectionRatio: 1,
            intersectionRect: target.getBoundingClientRect(),
            isIntersecting: true,
            rootBounds: null,
            target,
            time: 0,
          },
        ],
        this as unknown as IntersectionObserver,
      )
    })

    unobserve = vi.fn()
    disconnect = vi.fn()
    takeRecords = () => []
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver,
  })

  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: TestIntersectionObserver,
  })

  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })

  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })

  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })

  installTestLocalStorage()

  beforeEach(() => {
    const settings = {
      appearance: 'system' as const,
      migratedLegacyRendererPreferences: true,
      reasoningEffortByModel: {},
      selectedModel: null,
      defaultWorkspaceDirectory: null,
      mcpAutoStart: false,
      agentInteractionsInModal: false,
    }
    window.arkDesktop = {
      credentials: {
        list: vi.fn().mockResolvedValue({
          openai: { configured: false, storage: null },
          anthropic: { configured: false, storage: null },
          google: { configured: false, storage: null },
        }),
        save: vi.fn(),
        saveSession: vi.fn(),
        remove: vi.fn(),
        test: vi.fn(),
      },
      settings: {
        get: vi.fn().mockResolvedValue(settings),
        update: vi.fn().mockImplementation(async (patch) => ({ ...settings, ...patch })),
      },
      mcp: {
        getStatus: vi.fn().mockResolvedValue({
          state: 'stopped',
          autoStart: false,
          activeDeckId: null,
          activeDeckTitle: null,
          connectedClient: null,
          lastActivity: null,
          error: null,
        }),
        start: vi.fn(),
        stop: vi.fn(),
        setAutoStart: vi.fn(),
        setActiveDeck: vi.fn(),
        getPendingInteraction: vi.fn().mockResolvedValue(null),
        respondToInteraction: vi.fn().mockResolvedValue(undefined),
        cancelInteraction: vi.fn().mockResolvedValue(false),
        getSetupCommands: vi.fn().mockResolvedValue({ codex: '', claudeCode: '' }),
        copySetupCommand: vi.fn().mockResolvedValue(undefined),
        onStatusChanged: vi.fn().mockReturnValue(() => undefined),
        onDeckUpdated: vi.fn().mockReturnValue(() => undefined),
        onInteractionChanged: vi.fn().mockReturnValue(() => undefined),
      },
      updates: { check: vi.fn() },
      files: {
        openWorkspace: vi.fn(),
        chooseWorkspacePath: vi.fn(),
        chooseDirectory: vi.fn(),
        reveal: vi.fn(),
      },
    }
  })

  afterEach(() => {
    getTestLocalStorage().clear()
    resetDesktopSettingsForTests()
    cleanup()
    vi.clearAllMocks()
  })
} else {
  afterEach(() => {
    vi.clearAllMocks()
  })
}
