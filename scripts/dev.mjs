import concurrently, { Logger } from 'concurrently'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktop = resolve(root, 'apps/desktop')

let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = true
  })
}

const logger = new Logger({ prefixFormat: 'name' })
const logCommandEvent = logger.logCommandEvent.bind(logger)
logger.logCommandEvent = (text, command) => {
  if (interrupted && /exited with code /.test(text)) return
  if (/exited with code (SIGINT|SIGTERM|SIGHUP|130)\b/i.test(text)) return
  logCommandEvent(text, command)
}

const { result } = concurrently(
  [
    {
      name: 'renderer',
      cwd: desktop,
      command: 'vite --host 127.0.0.1 --port 5173 --strictPort',
      prefixColor: 'cyan',
    },
    {
      name: 'main',
      cwd: desktop,
      command: 'vite build --watch --config vite.electron.config.ts',
      prefixColor: 'magenta',
    },
    {
      name: 'preload',
      cwd: desktop,
      command: 'vite build --watch --config vite.preload.config.ts',
      prefixColor: 'yellow',
    },
    {
      name: 'electron',
      cwd: root,
      command: 'node scripts/run-electron.mjs',
      prefixColor: 'blue',
    },
  ],
  { logger },
)

try {
  await result
} catch {
  if (!interrupted) process.exit(1)
}

process.exit(0)
