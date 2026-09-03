import { describe, expect, it } from 'vitest'

import {
  bundleRuntimeEntry,
  renderGeneratedModule,
  RUNTIME_ENTRIES,
} from '../../../scripts/build-runtimes.mjs'
import { DECK_CSS_NAV_RUNTIME_SOURCE } from './generated/css-nav.source.ts'
import { DECK_CUSTOM_BRIDGE_RUNTIME_SOURCE } from './generated/custom-bridge.source.ts'
import { DECK_HANDSHAKE_RUNTIME_SOURCE } from './generated/handshake.source.ts'
import { DECK_REVEAL_ADAPTER_RUNTIME_SOURCE } from './generated/reveal-adapter.source.ts'

const COMMITTED: Record<string, string> = {
  'deck-handshake': DECK_HANDSHAKE_RUNTIME_SOURCE,
  'deck-css-nav': DECK_CSS_NAV_RUNTIME_SOURCE,
  'deck-custom-bridge': DECK_CUSTOM_BRIDGE_RUNTIME_SOURCE,
  'deck-reveal-adapter': DECK_REVEAL_ADAPTER_RUNTIME_SOURCE,
}

describe('committed deck-preview runtime bundles', () => {
  it('match an in-memory esbuild rebuild', async () => {
    const entries = RUNTIME_ENTRIES.filter((entry) => entry.id in COMMITTED)
    expect(entries).toHaveLength(4)

    for (const entry of entries) {
      const source = await bundleRuntimeEntry(entry)
      expect(source).toBe(COMMITTED[entry.id])
      expect(renderGeneratedModule(entry.exportName, source)).toContain(
        `export const ${entry.exportName} =`,
      )
    }
  })
})
