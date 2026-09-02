import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: 'dist/main',
    sourcemap: true,
    ssr: 'electron/main.ts',
    rollupOptions: {
      external: ['electron', 'electron-updater'],
      output: {
        entryFileNames: 'main.js',
      },
    },
  },
  ssr: {
    noExternal: [/^@ark\//, /^@modelcontextprotocol\//, 'jsonc-parser'],
  },
})
