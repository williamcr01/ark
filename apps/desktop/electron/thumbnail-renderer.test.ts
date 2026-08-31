/**
 * Electron main-process code: no DOM, and jsdom's realm would break
 * `instanceof` checks in libraries that run against Node's globals.
 *
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { BrowserWindow, session, type Session } from 'electron'
import type { PreviewSessionStore } from '@ark/storage/stores/preview-sessions.ts'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  session: { fromPartition: vi.fn() },
}))

import { gotoDeckSlide } from './deck-render-window.ts'
import { createElectronThumbnailRenderer } from './thumbnail-renderer.ts'

function fakeWindow(executeJavaScript: (source: string) => unknown) {
  return {
    webContents: {
      executeJavaScript: vi.fn(async (source: string) => executeJavaScript(source)),
    },
  } as unknown as BrowserWindow
}

describe('Electron thumbnail navigation', () => {
  it('navigates before requesting slide settle', async () => {
    let index = 0
    const calls: string[] = []
    const window = fakeWindow((source) => {
      calls.push(source)
      if (source.includes('ready: Boolean')) return { ready: true, index, errors: [] }
      if (source.includes('__arkThumbGoto')) {
        index = 1
        return true
      }
      if (source.includes('__arkThumbRequestSettle')) return 6
      if (source.includes('__arkThumbSettledRequestId')) return { settled: true, errors: [] }
      throw new Error(`Unexpected script: ${source}`)
    })

    await gotoDeckSlide(window, 1, { label: 'Thumbnail renderer' })

    const gotoIndex = calls.findIndex((source) => source.includes('__arkThumbGoto(1)'))
    const settleIndex = calls.findIndex((source) => source.includes('__arkThumbRequestSettle(1)'))
    expect(gotoIndex).toBeGreaterThan(-1)
    expect(settleIndex).toBeGreaterThan(gotoIndex)
  })

  it('waits for the adaptive settle acknowledgement', async () => {
    let settlePolls = 0
    const window = fakeWindow((source) => {
      if (source.includes('ready: Boolean')) return { ready: true, index: 0, errors: [] }
      if (source.includes('__arkThumbRequestSettle')) return 7
      if (source.includes('__arkThumbSettledRequestId')) {
        settlePolls += 1
        return { settled: settlePolls >= 2, errors: [] }
      }
      throw new Error(`Unexpected script: ${source}`)
    })

    await gotoDeckSlide(window, 0)

    expect(settlePolls).toBeGreaterThanOrEqual(2)
    expect(window.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringMatching(/__arkThumbSettledIndex\s*\?\?\s*-1/),
      true,
    )
  })

  it('does not swallow errors reported while settling', async () => {
    const window = fakeWindow((source) => {
      if (source.includes('ready: Boolean')) return { ready: true, index: 0, errors: [] }
      if (source.includes('__arkThumbRequestSettle')) return 8
      if (source.includes('__arkThumbSettledRequestId')) {
        return { settled: false, errors: ['Deck settle failed.'] }
      }
      throw new Error(`Unexpected script: ${source}`)
    })

    await expect(gotoDeckSlide(window, 0)).rejects.toThrow('Deck settle failed.')
  })

  it('fails the capture when the deck reports a different slide after settling', async () => {
    let index = 0
    const window = fakeWindow((source) => {
      if (source.includes('ready: Boolean')) return { ready: true, index, errors: [] }
      if (source.includes('__arkThumbGoto')) {
        index = 1
        return true
      }
      if (source.includes('__arkThumbRequestSettle')) return 9
      if (source.includes('__arkThumbSettledRequestId')) {
        // Simulates a deck that navigated away (e.g. auto-advanced) while settling.
        index = 0
        return { settled: true, errors: [] }
      }
      throw new Error(`Unexpected script: ${source}`)
    })

    await expect(gotoDeckSlide(window, 1, { label: 'Thumbnail renderer' })).rejects.toThrow(
      'Thumbnail renderer reached slide 0, expected 1.',
    )
  })
})

describe('Electron thumbnail renderer', () => {
  it('fails the render when the deck runtime reports a different slide count', async () => {
    const webContents = {
      setWindowOpenHandler: vi.fn(() => ({ action: 'deny' })),
      executeJavaScript: vi.fn(async (source: string) => {
        if (source.includes('ready: Boolean')) {
          return { ready: true, index: 0, slideCount: 3, errors: [] }
        }
        throw new Error(`Unexpected script: ${source}`)
      }),
      capturePage: vi.fn(),
    }
    const window = {
      loadURL: vi.fn(async () => undefined),
      destroy: vi.fn(() => undefined),
      isDestroyed: vi.fn(() => false),
      webContents,
    }
    vi.mocked(BrowserWindow).mockImplementation(function () {
      return window as unknown as BrowserWindow
    })
    vi.mocked(session.fromPartition).mockReturnValue({
      setPermissionRequestHandler: vi.fn(),
      webRequest: { onBeforeRequest: vi.fn(), onBeforeSendHeaders: vi.fn() },
    } as unknown as Session)

    const previewSessionStore = {
      createSession: vi.fn(() => ({ token: 'thumb-token' })),
      deleteSession: vi.fn(),
    } as unknown as PreviewSessionStore

    const renderer = createElectronThumbnailRenderer({
      apiOrigin: 'http://127.0.0.1:8787',
      previewSessionStore,
      renderSecret: 'render-secret',
    })

    const result = await renderer.render({
      html: '<!DOCTYPE html><html><head></head><body><section class="slide"><h1>One</h1></section></body></html>',
      slideCount: 1,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Deck reports 3 slides at runtime; expected 1.')
    }
    expect(webContents.capturePage).not.toHaveBeenCalled()
    expect(window.destroy).toHaveBeenCalled()
  })
})
