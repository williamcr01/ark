import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type RuntimeAssetKind = 'script' | 'stylesheet'

type ManifestAsset = {
  path: string
  kind: RuntimeAssetKind
  sha256: string
  size: number
}

type ManifestRuntime = {
  id: string
  version: string
  runtimeMode: 'reveal' | 'custom-js'
  license: string
  source: string
  previewMode: 'css-only' | 'full-js'
  allowsDeckScripts: boolean
  allowedGlobals?: string[]
  markers: Record<string, string[]>
  structureHints?: string[]
  requiredAssets: {
    css?: string[]
    js?: string[]
  }
  assets: ManifestAsset[]
}

type RuntimeManifest = {
  schemaVersion: number
  runtimes: ManifestRuntime[]
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIMES_DIR = path.join(ROOT, 'runtimes')
const MANIFEST_PATH = path.join(RUNTIMES_DIR, 'manifest.json')
const REVEAL_SOURCE = path.join(ROOT, 'node_modules', 'reveal.js', 'dist')

function inferAssetKind(filePath: string): RuntimeAssetKind {
  return filePath.endsWith('.js') ? 'script' : 'stylesheet'
}

async function hashFile(filePath: string) {
  const body = await fs.readFile(filePath)
  const sha256 = createHash('sha256').update(body).digest('hex')

  return {
    sha256,
    size: body.byteLength,
  }
}

async function copyRevealAssets(targetVersionDir: string) {
  const copies: Array<{ source: string; target: string }> = [
    {
      source: path.join(REVEAL_SOURCE, 'reveal.js'),
      target: path.join(targetVersionDir, 'reveal.js'),
    },
    {
      source: path.join(REVEAL_SOURCE, 'reveal.css'),
      target: path.join(targetVersionDir, 'reveal.css'),
    },
    {
      source: path.join(REVEAL_SOURCE, 'reset.css'),
      target: path.join(targetVersionDir, 'reset.css'),
    },
    {
      source: path.join(REVEAL_SOURCE, 'theme', 'white.css'),
      target: path.join(targetVersionDir, 'theme', 'white.css'),
    },
  ]

  for (const copy of copies) {
    await fs.mkdir(path.dirname(copy.target), { recursive: true })
    await fs.copyFile(copy.source, copy.target)
  }
}

async function buildAssetMetadata(versionDir: string, assetPath: string): Promise<ManifestAsset> {
  const absolutePath = path.join(versionDir, assetPath)
  const { sha256, size } = await hashFile(absolutePath)

  return {
    path: assetPath,
    kind: inferAssetKind(assetPath),
    sha256,
    size,
  }
}

async function syncRevealRuntime(manifest: RuntimeManifest) {
  const entry = manifest.runtimes.find((runtime) => runtime.id === 'reveal.js')

  if (!entry) {
    throw new Error('reveal.js runtime entry is missing from manifest.json')
  }

  const versionDir = path.join(RUNTIMES_DIR, entry.id, entry.version)

  try {
    await fs.access(REVEAL_SOURCE)
    await copyRevealAssets(versionDir)
    console.log(`Copied reveal.js@${entry.version} assets from node_modules`)
  } catch {
    console.log(`Using committed reveal.js@${entry.version} assets in ${versionDir}`)
  }

  const assetPaths = [
    ...(entry.requiredAssets.js ?? []),
    ...(entry.requiredAssets.css ?? []),
    'reset.css',
  ]

  entry.assets = await Promise.all(
    assetPaths.map((assetPath) => buildAssetMetadata(versionDir, assetPath)),
  )
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8')) as RuntimeManifest

  await syncRevealRuntime(manifest)

  await fs.writeFile(`${MANIFEST_PATH}`, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Updated ${MANIFEST_PATH}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
