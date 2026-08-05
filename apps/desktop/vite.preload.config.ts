import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: 'dist/preload',
    sourcemap: true,
    ssr: 'electron/preload.ts',
    rollupOptions: {
      external: ['electron'],
      output: {
        entryFileNames: 'preload.cjs',
        format: 'cjs',
      },
    },
  },
})
