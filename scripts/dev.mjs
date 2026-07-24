import concurrently, { Logger } from 'concurrently'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = true
  })
}

const logger = new Logger({ prefixFormat: 'name' })
const logCommandEvent = logger.logCommandEvent.bind(logger)
logger.logCommandEvent = (text, command) => {
  // Ctrl+C / terminate — not a real failure; skip the noisy exit lines.
  if (interrupted && /exited with code /.test(text)) return
  if (/exited with code (SIGINT|SIGTERM|SIGHUP|130)\b/i.test(text)) return
  logCommandEvent(text, command)
}

const { result } = concurrently(
  [
    {
      name: 'api',
      cwd: resolve(root, 'apps/api'),
      command: 'tsx watch index.ts',
      prefixColor: 'magenta',
    },
    {
      name: 'sandbox',
      cwd: resolve(root, 'apps/sandbox'),
      command: 'tsx watch sandbox-index.ts',
      prefixColor: 'yellow',
    },
    {
      name: 'web',
      cwd: resolve(root, 'apps/web'),
      command: 'node ../../scripts/wait-for-api.mjs && vite',
      prefixColor: 'cyan',
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
