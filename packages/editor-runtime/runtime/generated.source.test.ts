import { describe, expect, it } from 'vitest'

import {
  bundleRuntimeEntry,
  renderGeneratedModule,
  RUNTIME_ENTRIES,
} from '../../../scripts/build-runtimes.mjs'
import { EDITOR_RUNTIME_SOURCE } from './generated/editor-runtime.source.ts'

describe('committed editor runtime bundle', () => {
  it('matches an in-memory esbuild rebuild', async () => {
    const entry = RUNTIME_ENTRIES.find((item) => item.id === 'editor-runtime')
    expect(entry).toBeDefined()
    const source = await bundleRuntimeEntry(entry!)
    expect(source).toBe(EDITOR_RUNTIME_SOURCE)
    expect(renderGeneratedModule(entry!.exportName, source)).toContain(
      'export const EDITOR_RUNTIME_SOURCE =',
    )
  })
})
