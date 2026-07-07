import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateArkOpenApiDocument } from '../shared/api/openapi-registry.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const outputPath = path.join(repoRoot, 'openapi', 'ark.openapi.json')

async function main() {
  const checkOnly = process.argv.includes('--check')
  const document = generateArkOpenApiDocument()
  const serialized = `${JSON.stringify(document, null, 2)}\n`

  if (checkOnly) {
    let existing = ''

    try {
      existing = await readFile(outputPath, 'utf8')
    } catch {
      console.error(`OpenAPI spec missing at ${outputPath}. Run pnpm openapi:generate.`)
      process.exit(1)
    }

    if (existing !== serialized) {
      console.error(`OpenAPI spec is out of date. Run pnpm openapi:generate and commit the result.`)
      process.exit(1)
    }

    console.log('OpenAPI spec is up to date.')
    return
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, serialized, 'utf8')
  console.log(`Wrote ${outputPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
