import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const timeoutMs = Number(process.env.ARK_WAIT_FOR_API_TIMEOUT_MS ?? 60_000)

function resolvePort() {
  const fromEnv = process.env.PORT?.trim()
  if (fromEnv) return fromEnv

  const envPath = resolve(root, '.env')
  if (!existsSync(envPath)) return '8787'

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    if (trimmed.slice(0, eq).trim() !== 'PORT') continue
    return trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
  }

  return '8787'
}

const url = `http://127.0.0.1:${resolvePort()}/api/health`
const deadline = Date.now() + timeoutMs

while (Date.now() < deadline) {
  try {
    const response = await fetch(url)
    if (response.ok) process.exit(0)
  } catch {
    // API not listening yet
  }
  await new Promise((resolve) => setTimeout(resolve, 200))
}

console.error(`Timed out waiting for Ark API at ${url}`)
process.exit(1)
