import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const candidates = [
  process.env.ARK_MCP_EXECUTABLE,
  path.resolve('release/linux-unpacked/ark'),
  path.resolve('release/win-unpacked/Ark.exe'),
  path.resolve('release/mac/Ark.app/Contents/MacOS/Ark'),
].filter(Boolean)

let executable = null
for (const candidate of candidates) {
  try {
    await access(candidate)
    executable = candidate
    break
  } catch {
    // Try the next platform artifact.
  }
}

if (!executable) {
  throw new Error('No packaged Ark executable found. Run pnpm package first.')
}

const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ark-mcp-smoke-'))
const child = spawn(executable, ['--headless', '--mcp', `--user-data-dir=${userDataDirectory}`], {
  stdio: ['pipe', 'pipe', 'pipe'],
})
let stderr = ''
let stdoutBuffer = ''
const responses = new Map()
const waiters = new Map()

const failTimer = setTimeout(() => {
  child.kill('SIGTERM')
  throw new Error(`MCP smoke timed out. ${stderr}`)
}, 20_000)

child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk) => {
  stderr += chunk
})

child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk
  const lines = stdoutBuffer.split('\n')
  stdoutBuffer = lines.pop() ?? ''
  for (const line of lines) {
    if (!line) continue
    const message = JSON.parse(line)
    if (message.id === undefined) continue
    const waiter = waiters.get(message.id)
    if (waiter) {
      waiters.delete(message.id)
      waiter(message)
    } else {
      responses.set(message.id, message)
    }
  }
})

const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)
const receive = (id) => {
  const response = responses.get(id)
  if (response) {
    responses.delete(id)
    return Promise.resolve(response)
  }
  return new Promise((resolve) => waiters.set(id, resolve))
}

try {
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'ark-package-smoke', version: '1.0.0' },
    },
  })
  const initialized = await receive(1)
  if (!initialized.result?.serverInfo || initialized.error) {
    throw new Error(`MCP initialize failed: ${JSON.stringify(initialized)}`)
  }

  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  const listed = await receive(2)
  const toolNames = listed.result?.tools?.map((tool) => tool.name).toSorted()
  const expectedTools = [
    'edit_deck',
    'get_active_deck',
    'get_authoring_guide',
    'list_slides',
    'parse_deck',
    'patch_deck',
    'patch_element',
    'read_deck',
    'write_deck',
  ]
  if (JSON.stringify(toolNames) !== JSON.stringify(expectedTools)) {
    throw new Error(`Unexpected MCP tools: ${JSON.stringify(toolNames)}`)
  }

  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'get_active_deck', arguments: {} },
  })
  const disabled = await receive(3)
  if (!disabled.result?.isError || disabled.result?.structuredContent?.code !== 'MCP_DISABLED') {
    throw new Error(`Expected recoverable MCP_DISABLED result: ${JSON.stringify(disabled)}`)
  }

  child.stdin.end()
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (exitCode !== 0) throw new Error(`MCP bridge exited with ${exitCode}. ${stderr}`)
  console.log('ARK_MCP_SMOKE_OK')
} finally {
  clearTimeout(failTimer)
  if (child.exitCode === null) child.kill('SIGTERM')
  await rm(userDataDirectory, { recursive: true, force: true })
}
