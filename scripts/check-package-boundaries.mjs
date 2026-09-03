#!/usr/bin/env node

/**
 * Enforces the package layering that `docs/architecture-boundaries.md` describes.
 *
 * ESLint's `no-restricted-imports` catches the coarse rules (renderer ↛ apps/api, packages ↛ apps,
 * browser-safe ↛ node:*), but it cannot see the layer graph: it does not know that @ark/storage
 * sits below @ark/contracts, or that a declared dependency nothing imports is a phantom edge that
 * can make the graph cyclic without any source file being wrong. This checks all of that, and
 * rejects a browser-safe package importing a server-only package even when the layer number
 * would allow it.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The stack. A package may import from a strictly lower layer only. */
export const LAYERS = {
  '@ark/runtime-registry': 0,
  '@ark/telemetry': 0,
  '@ark/deck': 1,
  '@ark/ai': 1,
  '@ark/editor-runtime': 2,
  '@ark/chat': 2,
  '@ark/deck-export': 2,
  '@ark/deck-import': 2,
  '@ark/deck-node': 2,
  '@ark/deck-preview': 3,
  '@ark/storage': 4,
  '@ark/contracts': 5,
  '@ark/agent': 6,
  '@ark/mcp': 7,
}

/** Packages the renderer must not bundle: they use node built-ins. */
export const SERVER_ONLY = new Set([
  '@ark/storage',
  '@ark/agent',
  '@ark/mcp',
  '@ark/deck-import',
  '@ark/deck-node',
])

function listDir(dir) {
  return existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())
    : []
}

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

export function collectWorkspace(repoRoot = root) {
  const workspace = new Map()
  for (const group of ['packages', 'apps']) {
    for (const entry of listDir(path.join(repoRoot, group))) {
      const dir = path.join(repoRoot, group, entry.name)
      const manifestPath = path.join(dir, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      workspace.set(manifest.name, { dir, group, manifest })
    }
  }

  for (const [name, entry] of workspace) {
    const used = new Set()
    for (const file of sourceFiles(entry.dir)) {
      const text = readFileSync(file, 'utf8')
      for (const [, ref] of text.matchAll(/['"](@ark\/[a-z-]+)/g)) {
        if (workspace.has(ref) && ref !== name) used.add(ref)
      }
    }
    entry.used = used
    entry.declared = new Set(
      Object.keys(entry.manifest.dependencies ?? {}).filter((d) => workspace.has(d)),
    )
  }
  return workspace
}

export function findViolations(workspace, repoRoot = root) {
  const problems = []

  for (const [name, entry] of workspace) {
    for (const dep of [...entry.declared].sort()) {
      if (!entry.used.has(dep)) {
        problems.push(`${name}: declares ${dep} but imports nothing from it (phantom edge)`)
      }
    }
    for (const dep of [...entry.used].sort()) {
      if (!entry.declared.has(dep)) {
        problems.push(`${name}: imports ${dep} without declaring it in package.json`)
      }
    }

    const layer = LAYERS[name]
    if (layer === undefined) continue
    const browserSafe = !SERVER_ONLY.has(name)
    for (const dep of [...entry.used].sort()) {
      const depLayer = LAYERS[dep]
      if (depLayer === undefined) {
        problems.push(`${name} (layer ${layer}) imports ${dep}, which has no declared layer`)
      } else if (depLayer >= layer) {
        problems.push(
          `${name} (layer ${layer}) imports ${dep} (layer ${depLayer}) — packages may import from a strictly lower layer only`,
        )
      }
      if (browserSafe && SERVER_ONLY.has(dep)) {
        problems.push(
          `${name} is browser-safe but imports server-only ${dep} — browser-safe packages may not import server-only packages regardless of layer`,
        )
      }
    }
  }

  for (const name of Object.keys(LAYERS)) {
    if (!workspace.has(name)) problems.push(`${name} has a declared layer but no package`)
  }

  // A cycle can exist through declared edges even when every layer check passes.
  const state = new Map()
  const walk = (name, trail) => {
    if (state.get(name) === 'done') return
    if (state.get(name) === 'open') {
      problems.push(`dependency cycle: ${[...trail, name].join(' → ')}`)
      return
    }
    state.set(name, 'open')
    for (const dep of workspace.get(name)?.used ?? []) walk(dep, [...trail, name])
    state.set(name, 'done')
  }
  for (const name of workspace.keys()) walk(name, [])

  // The root solution file has no other guard: `pnpm typecheck` runs each project separately.
  const rootTsconfigPath = path.join(repoRoot, 'tsconfig.json')
  if (existsSync(rootTsconfigPath)) {
    const referenced = new Set(
      (JSON.parse(readFileSync(rootTsconfigPath, 'utf8')).references ?? []).map((r) =>
        r.path.replace(/^\.\//, ''),
      ),
    )
    const expected = new Set(
      [...workspace.values()]
        .filter((e) => existsSync(path.join(e.dir, 'tsconfig.json')))
        .map((e) => path.relative(repoRoot, e.dir).replaceAll('\\', '/')),
    )
    for (const missing of [...expected].filter((p) => !referenced.has(p)).sort()) {
      problems.push(`tsconfig.json: missing project reference ./${missing}`)
    }
    for (const stale of [...referenced].filter((p) => !expected.has(p)).sort()) {
      problems.push(`tsconfig.json: references ./${stale}, which is not a workspace project`)
    }
  }

  return problems
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = findViolations(collectWorkspace())
  if (problems.length > 0) {
    console.error('Package boundary violations:\n')
    for (const problem of problems) console.error(`  ${problem}`)
    console.error(`\n${problems.length} problem(s). See docs/architecture-boundaries.md.`)
    process.exit(1)
  }
  console.log(`Package boundaries OK (${Object.keys(LAYERS).length} layered packages).`)
}
