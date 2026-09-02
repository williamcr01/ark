import { describe, expect, it, vi } from 'vitest'

import { importPptxFromFile, importPptxFromPath, isPowerPointPath } from './pptx-import.ts'

const { toast } = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => 'pending'),
  },
}))
const importPptx = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/api/deck-api', () => ({
  importPptx: (...args: unknown[]) => importPptx(...args),
}))

describe('pptx-import', () => {
  it('treats ppt and pptx paths as PowerPoint', () => {
    expect(isPowerPointPath('/tmp/talk.pptx')).toBe(true)
    expect(isPowerPointPath('/tmp/talk.ppt')).toBe(true)
    expect(isPowerPointPath('/tmp/talk.ark')).toBe(false)
  })

  it('imports a path and returns the deck', async () => {
    importPptx.mockResolvedValueOnce({ id: 'deck-pptx' })
    await expect(importPptxFromPath('/tmp/talk.pptx')).resolves.toEqual({ id: 'deck-pptx' })
    expect(importPptx).toHaveBeenCalledWith({ path: '/tmp/talk.pptx', filename: 'talk.pptx' })
    expect(toast.success).toHaveBeenCalled()
  })

  it('rejects a legacy ppt file upload', async () => {
    const file = new File(['bytes'], 'old.ppt', { type: 'application/vnd.ms-powerpoint' })
    await expect(importPptxFromFile(file)).resolves.toBeNull()
    expect(importPptx).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
  })
})
