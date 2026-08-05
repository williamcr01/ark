import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktop = path.join(root, 'apps/desktop')
const electron = path.join(
  desktop,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.CMD' : 'electron',
)
const useXvfb =
  process.platform === 'linux' && !process.env.DISPLAY && existsSync('/usr/bin/xvfb-run')
const command = useXvfb ? '/usr/bin/xvfb-run' : electron
const args = useXvfb ? ['-a', electron, '.'] : ['.']

const child = spawn(command, args, {
  cwd: desktop,
  env: { ...process.env, ARK_DESKTOP_SMOKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
child.stdout.on('data', (chunk) => {
  output += chunk
  process.stdout.write(chunk)
})
child.stderr.on('data', (chunk) => {
  output += chunk
  process.stderr.write(chunk)
})

const timeout = setTimeout(() => child.kill('SIGTERM'), 60_000)
const exitCode = await new Promise((resolve) => child.once('exit', (code) => resolve(code ?? 1)))
clearTimeout(timeout)

if (exitCode !== 0 || !output.includes('ARK_DESKTOP_SMOKE_OK')) process.exit(1)
