import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), session: {} }))

import { gotoThumbnailSlide } from './thumbnail-renderer.ts'

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

    await gotoThumbnailSlide(window, 1)

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

    await gotoThumbnailSlide(window, 0)

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

    await expect(gotoThumbnailSlide(window, 0)).rejects.toThrow('Deck settle failed.')
  })
})
