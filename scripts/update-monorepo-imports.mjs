#!/usr/bin/env node
/**
 * One-shot import rewriter for the apps/packages monorepo migration (issue #136).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const runtimeRegistryFiles = new Set([
  'deck-runtime-registry',
  'deck-runtime-manifest',
  'runtime-stylesheet-content',
  'runtime-stylesheet-disk',
  'deck-runtime',
  'sandbox-origin',
])

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') {
      continue
    }
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full, files)
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry)) {
      files.push(full)
    }
  }
  return files
}

function rewriteImports(content, filePath) {
  let next = content

  // scripts / dynamic imports: server → apps/api, sandbox-host → apps/sandbox
  next = next.replaceAll("'../../server/", "'../../apps/api/")
  next = next.replaceAll('"../../server/', '"../../apps/api/')
  next = next.replaceAll("'../server/", "'../apps/api/")
  next = next.replaceAll('"../server/', '"../apps/api/')
  next = next.replaceAll(
    "await import('../../server/sandbox-host.ts')",
    "await import('../../apps/sandbox/sandbox-host.ts')",
  )

  // browser-smoke vite config path
  next = next.replaceAll(
    "path.join(repoRoot, 'vite.config.ts')",
    "path.join(repoRoot, 'apps/web/vite.config.ts')",
  )

  // shared/api contract entry
  next = next.replace(
    /from\s+(['"])(?:\.\.\/)+shared\/api\/index\.ts\1/g,
    'from $1@ark/contracts$1',
  )
  next = next.replace(/from\s+(['"])(?:\.\.\/)+shared\/api\1/g, 'from $1@ark/contracts$1')

  // shared/api internal modules (scripts, contracts tests)
  next = next.replace(
    /from\s+(['"])(?:\.\.\/)+shared\/api\/([^'"]+)\1/g,
    'from $1@ark/contracts/$2$1',
  )
  next = next.replace(/from\s+(['"])\.\/api\/([^'"]+)\1/g, (match, quote, subpath) => {
    if (!filePath.includes(`${path.sep}packages${path.sep}deck-core${path.sep}`)) {
      return match
    }
    if (subpath === 'index.ts') {
      return `from ${quote}@ark/contracts${quote}`
    }
    return `from ${quote}@ark/contracts/${subpath}${quote}`
  })

  // shared/* → workspace packages
  next = next.replace(/from\s+(['"])(?:\.\.\/)+shared\/([^'"]+)\1/g, (match, quote, subpath) => {
    const base = subpath.replace(/\.ts$/, '').replace(/\/index$/, '')
    if (base === 'api/index' || base === 'api') {
      return `from ${quote}@ark/contracts${quote}`
    }
    if (base.startsWith('api/')) {
      return `from ${quote}@ark/contracts/${base.slice(4)}${quote}`
    }
    const fileBase = path.basename(base)
    if (runtimeRegistryFiles.has(fileBase)) {
      return `from ${quote}@ark/runtime-registry/${subpath}${quote}`
    }
    return `from ${quote}@ark/deck-core/${subpath}${quote}`
  })

  // sandbox app: preview-sessions lives in api
  if (filePath.includes(`${path.sep}apps${path.sep}sandbox${path.sep}`)) {
    next = next.replaceAll("from './preview-sessions.ts'", "from '@ark/api/preview-sessions.ts'")
    next = next.replaceAll("from './app.ts'", "from '@ark/api/app.ts'")
  }

  // deck-core → runtime-registry internal cross-package imports
  if (filePath.includes(`${path.sep}packages${path.sep}deck-core${path.sep}`)) {
    for (const name of runtimeRegistryFiles) {
      next = next.replaceAll(`from './${name}.ts'`, `from '@ark/runtime-registry/${name}.ts'`)
      next = next.replaceAll(`from './${name}'`, `from '@ark/runtime-registry/${name}.ts'`)
    }
  }

  // runtime-registry manifest + disk roots (repo root is two levels up)
  if (filePath.includes(`${path.sep}packages${path.sep}runtime-registry${path.sep}`)) {
    next = next.replace(
      "import manifest from '../runtimes/manifest.json'",
      "import manifest from '../../runtimes/manifest.json'",
    )
    next = next.replace(
      "path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')",
      "path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')",
    )
  }

  return next
}

const files = walk(repoRoot).filter(
  (file) =>
    !file.includes(`${path.sep}scripts${path.sep}update-monorepo-imports.mjs`) &&
    !file.includes(`${path.sep}node_modules${path.sep}`),
)

let changed = 0
for (const file of files) {
  const original = readFileSync(file, 'utf8')
  const updated = rewriteImports(original, file)
  if (updated !== original) {
    writeFileSync(file, updated)
    changed += 1
  }
}

console.log(`Updated imports in ${changed} files.`)
