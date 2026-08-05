import { readFile, writeFile } from 'node:fs/promises'

const tag = process.argv[2] ?? ''
const version = tag.startsWith('v') ? tag.slice(1) : tag

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(
    `Release tag must be a semantic version such as v1.2.3; received ${tag || '(empty)'}.`,
  )
}

const packagePath = new URL('../apps/desktop/package.json', import.meta.url)
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
packageJson.version = version
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
