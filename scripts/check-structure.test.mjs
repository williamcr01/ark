import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  findStructureOffenders,
  formatStructureReport,
  STRUCTURE_LIMITS,
} from './check-structure.mjs'

const scriptPath = fileURLToPath(new URL('./check-structure.mjs', import.meta.url))

function writeTree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ark-structure-'))
  const src = join(dir, 'apps/desktop/src')
  mkdirSync(src, { recursive: true })
  for (const [relative, contents] of Object.entries(files)) {
    const full = join(src, relative)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, contents)
  }
  return { dir, src }
}

test('flags exported Props types over the field budget and ignores small ones', () => {
  const fields = Array.from(
    { length: STRUCTURE_LIMITS.MAX_PROPS_FIELDS + 1 },
    (_, index) => `  f${index}: string`,
  ).join('\n')
  const { dir, src } = writeTree({
    'Wide.tsx': `export interface WideProps {\n${fields}\n}\nexport type AlsoWideProps = {\n${fields}\n}\nexport interface OkProps { a: string; b: string }\ninterface HiddenProps {\n${fields}\n}\n`,
    'Wide.test.tsx': `export interface TestOnlyProps {\n${fields}\n}\n`,
  })
  try {
    const offenders = findStructureOffenders(src, dir)
    assert.deepEqual(
      offenders
        .filter((item) => item.kind === 'props')
        .map((item) => item.name)
        .sort(),
      ['AlsoWideProps', 'WideProps'],
    )
    assert.equal(offenders.find((item) => item.name === 'WideProps')?.count, 13)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flags export function use* object-literal returns over the key budget', () => {
  const keys = Array.from(
    { length: STRUCTURE_LIMITS.MAX_HOOK_RETURN_KEYS + 1 },
    (_, index) => `    k${index},`,
  ).join('\n')
  const { dir, src } = writeTree({
    'useWide.ts': `export function useWide() {\n  const k0 = 0, k1 = 1, k2 = 2, k3 = 3, k4 = 4, k5 = 5, k6 = 6, k7 = 7, k8 = 8, k9 = 9, k10 = 10\n  return {\n${keys}\n  }\n}\nexport function useOk() {\n  return { a: 1, b: 2 }\n}\nfunction useHidden() {\n  return {\n${keys}\n  }\n}\n`,
  })
  try {
    const offenders = findStructureOffenders(src, dir)
    assert.deepEqual(
      offenders.filter((item) => item.kind === 'hook-return').map((item) => item.name),
      ['useWide'],
    )
    assert.equal(offenders[0]?.count, STRUCTURE_LIMITS.MAX_HOOK_RETURN_KEYS + 1)
    const { lines } = formatStructureReport(offenders)
    assert.match(lines[0], /Structure budget inventory/)
    assert.match(lines.join('\n'), /useWide/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--strict exits 1 when the inventory is non-empty, 0 when it is empty', () => {
  const emptyRoot = mkdtempSync(join(tmpdir(), 'ark-structure-empty-'))
  try {
    const empty = spawnSync(process.execPath, [scriptPath, '--strict', `--root=${emptyRoot}`], {
      encoding: 'utf8',
    })
    assert.equal(empty.status, 0)
  } finally {
    rmSync(emptyRoot, { recursive: true, force: true })
  }

  const { dir } = writeTree({
    'useWide.ts': `export function useWide() {\n  return { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11 }\n}\n`,
  })
  try {
    const crowded = spawnSync(process.execPath, [scriptPath, '--strict', `--root=${dir}`], {
      encoding: 'utf8',
    })
    assert.equal(crowded.status, 1)
    assert.match(crowded.stderr, /useWide/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
