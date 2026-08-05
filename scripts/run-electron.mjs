import { spawn } from 'node:child_process'
import { existsSync, watch } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktop = path.join(root, 'apps/desktop')
const mainEntry = path.join(desktop, 'dist/main/main.js')
const preloadEntry = path.join(desktop, 'dist/preload/preload.cjs')
const electronBin = path.join(desktop, 'node_modules/.bin/electron')
const rendererUrl = 'http://127.0.0.1:5173'

let child = null
let stopping = false
let restartTimer = null
const watchers = []

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitUntilReady() {
  while (!stopping) {
    if (existsSync(mainEntry) && existsSync(preloadEntry)) {
      try {
        const response = await fetch(rendererUrl)
        if (response.ok) return
      } catch {
        // Build and renderer are still starting.
      }
    }
    await sleep(100)
  }
}

function launch() {
  if (stopping) return
  child = spawn(electronBin, ['.'], {
    cwd: desktop,
    env: {
      ...process.env,
      ARK_DESKTOP_RENDERER_URL: rendererUrl,
      PORT: '8787',
      SANDBOX_PORT: '5174',
    },
    stdio: 'inherit',
  })
  child.once('exit', (code, signal) => {
    child = null
    if (!stopping && code && signal === null) process.exitCode = code
  })
}

function restart() {
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    if (!child) {
      launch()
      return
    }
    const previous = child
    previous.once('exit', launch)
    previous.kill('SIGTERM')
  }, 150)
}

function stop(signal) {
  if (stopping) return
  stopping = true
  if (restartTimer) clearTimeout(restartTimer)
  for (const watcher of watchers) watcher.close()
  child?.kill(signal)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stop(signal))
}

await waitUntilReady()
if (!stopping) {
  launch()
  for (const directory of [path.dirname(mainEntry), path.dirname(preloadEntry)]) {
    watchers.push(watch(directory, { persistent: true }, restart))
  }
}
