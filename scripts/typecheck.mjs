#!/usr/bin/env node

/**
 * Parallel workspace typecheck.
 *
 * Root `tsc -b` with `noEmit` is a poor fit here: every project is treated as
 * perpetually stale (missing .js outputs), so warm runs rebuild everything, and
 * projects run strictly sequentially. This script typechecks each tsconfig with
 * `tsc --noEmit -p` and a small worker pool instead.
 *
 * Prefers the native TypeScript 7 binary from `@typescript/native` when present
 * (side-by-side with the TypeScript 6 API package used by eslint). Falls back to
 * `typescript`'s `tsc` / `tsc6`.
 */

import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))

const PROJECTS = [
  'apps/desktop/tsconfig.app.json',
  'apps/desktop/tsconfig.node.json',
  'apps/api/tsconfig.json',
  'apps/mcp/tsconfig.json',
  'apps/sandbox/tsconfig.json',
  'packages/ai/tsconfig.json',
  'packages/agent/tsconfig.json',
  'packages/chat/tsconfig.json',
  'packages/contracts/tsconfig.json',
  'packages/deck/tsconfig.json',
  'packages/deck-import/tsconfig.json',
  'packages/deck-preview/tsconfig.json',
  'packages/editor-runtime/tsconfig.json',
  'packages/mcp/tsconfig.json',
  'packages/runtime-registry/tsconfig.json',
  'packages/storage/tsconfig.json',
  'packages/telemetry/tsconfig.json',
]

/** Keep below CPU count: each `tsc` is memory-heavy and oversubscription regresses. */
const DEFAULT_CONCURRENCY = 3

function resolveTscBin() {
  const candidates = [
    // TypeScript 7 native (npm alias `@typescript/native` → typescript@7)
    tryResolveBin('@typescript/native', 'tsc'),
    // Classic TypeScript 6 API package (`tsc6` when using @typescript/typescript6)
    tryResolveBin('typescript', 'tsc6'),
    tryResolveBin('typescript', 'tsc'),
    path.join(root, 'node_modules', '.bin', 'tsc'),
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error('Unable to resolve a tsc binary (install typescript / @typescript/native).')
}

function tryResolveBin(pkg, binName) {
  try {
    const pkgJsonPath = require.resolve(`${pkg}/package.json`)
    const pkgJson = require(pkgJsonPath)
    const bin = pkgJson.bin?.[binName] ?? (typeof pkgJson.bin === 'string' ? pkgJson.bin : null)
    if (!bin || typeof bin !== 'string') return null
    return path.resolve(path.dirname(pkgJsonPath), bin)
  } catch {
    return null
  }
}

function runTsc(tscBin, project) {
  return new Promise((resolve) => {
    const child = spawn(tscBin, ['--noEmit', '-p', project], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', (error) => {
      resolve({ project, code: 1, output: `${error.message}\n` })
    })
    child.on('close', (code) => {
      resolve({ project, code: code ?? 1, output })
    })
  })
}

async function typecheck(projects = PROJECTS, concurrency = DEFAULT_CONCURRENCY) {
  const tscBin = resolveTscBin()
  const workers = Math.max(1, Math.min(concurrency, projects.length, availableParallelism()))
  let next = 0
  let failed = false
  const results = []

  async function worker() {
    while (next < projects.length) {
      const index = next
      next += 1
      const project = projects[index]
      const result = await runTsc(tscBin, project)
      results[index] = result
      if (result.code !== 0) failed = true
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()))

  for (const result of results) {
    if (!result) continue
    if (result.output) process.stdout.write(result.output)
  }

  return failed ? 1 : 0
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isMain) {
  const args = process.argv.slice(2)
  const concurrencyFlag = args.find((arg) => arg.startsWith('--concurrency='))
  const concurrency = concurrencyFlag
    ? Number.parseInt(concurrencyFlag.slice('--concurrency='.length), 10)
    : DEFAULT_CONCURRENCY
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    console.error('Invalid --concurrency= value')
    process.exit(2)
  }
  const projects = args.filter((arg) => !arg.startsWith('--'))
  process.exit(await typecheck(projects.length ? projects : PROJECTS, concurrency))
}

export { PROJECTS, DEFAULT_CONCURRENCY, typecheck, resolveTscBin }
