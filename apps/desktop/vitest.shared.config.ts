import { defineConfig } from 'vitest/config'

import viteConfig from './vite.config.ts'

// Module-level mocks need a fresh module graph per file.
export const isolatedTests = [
  'src/App.generation-history.test.tsx',
  'src/App.test.tsx',
  'src/App.undo-redo.test.tsx',
  'src/components/AgentInteractionModal.test.tsx',
  'src/components/ChatPanel.test.tsx',
  'src/components/DeckPreview.editor.test.tsx',
  'src/components/DeckPreview.frame.test.tsx',
  'src/components/DeckPreview.inspector.test.tsx',
  'src/components/DeckRestoreHistoryMenu.test.tsx',
  'src/components/EditModeToolbar.test.tsx',
  'src/components/ThemePicker.test.tsx',
  'src/hooks/useDeckActions.test.tsx',
  'src/hooks/useDeckGenerationFlow.test.tsx',
  'src/hooks/useDeckPreviewFrame.test.tsx',
  'src/pages/DecksDashboard.test.tsx',
  'electron/thumbnail-renderer.test.ts',
  'electron/deck-export.test.ts',
  'electron/deck-pptx.test.ts',
]

export default defineConfig((configEnv) => {
  const base = viteConfig(configEnv)

  return {
    ...base,
    root: __dirname,
    test: {
      ...base.test,
      name: '@ark/desktop-shared',
      include: ['src/**/*.{test,spec}.{ts,tsx}', 'electron/**/*.{test,spec}.ts'],
      exclude: isolatedTests,
      isolate: false,
      pool: 'threads',
    },
  }
})
