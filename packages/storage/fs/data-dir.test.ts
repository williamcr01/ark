import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveArkDataDir } from './data-dir.ts'

const originalDataDir = process.env.ARK_DATA_DIR

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.ARK_DATA_DIR
  else process.env.ARK_DATA_DIR = originalDataDir
})

describe('resolveArkDataDir', () => {
  it('routes every local store below the Electron userData override', () => {
    process.env.ARK_DATA_DIR = '/tmp/ark-user-data'

    expect(resolveArkDataDir('assets', 'blobs')).toBe(
      path.join('/tmp/ark-user-data', 'assets', 'blobs'),
    )
  })
})
