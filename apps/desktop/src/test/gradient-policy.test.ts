import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const forbidden = new RegExp(
  ['linear', 'radial', 'conic']
    .map((kind) => `${kind}-${'gradient'}`)
    .concat('bg-gradient')
    .join('|'),
)

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) return sourceFiles(filename)
      return /\.(css|tsx)$/.test(entry.name) ? [filename] : []
    }),
  )
  return nested.flat()
}

describe('frontend gradient policy', () => {
  it('keeps Ark-authored CSS and TSX free of gradients', async () => {
    const root = path.resolve(import.meta.dirname, '..')
    const violations: string[] = []

    for (const filename of await sourceFiles(root)) {
      if (forbidden.test(await readFile(filename, 'utf8')))
        violations.push(path.relative(root, filename))
    }

    expect(violations).toEqual([])
  })
})
