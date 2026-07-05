import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type RuntimeAssetKind = 'script' | 'stylesheet' | 'font'

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
const REVEAL_THEME_FONT_FAMILY = 'source-sans-pro'

function inferAssetKind(filePath: string): RuntimeAssetKind {
  if (filePath.endsWith('.js')) {
    return 'script'
  }

  if (filePath.endsWith('.css')) {
    return 'stylesheet'
  }

  return 'font'
}

async function hashFile(filePath: string) {
  const body = await fs.readFile(filePath)
  const sha256 = createHash('sha256').update(body).digest('hex')

  return {
    sha256,
    size: body.byteLength,
  }
}

async function copyRevealFontAssets(targetVersionDir: string) {
  await fs.cp(
    path.join(REVEAL_SOURCE, 'theme', 'fonts', REVEAL_THEME_FONT_FAMILY),
    path.join(targetVersionDir, 'theme', 'fonts', REVEAL_THEME_FONT_FAMILY),
    { recursive: true },
  )
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
    await copyRevealFontAssets(versionDir)
    console.log(`Copied reveal.js@${entry.version} theme font assets from node_modules`)
  } catch {
    console.log(`Using committed reveal.js@${entry.version} assets in ${versionDir}`)
  }

  const fontRoot = path.join(versionDir, 'theme', 'fonts', REVEAL_THEME_FONT_FAMILY)
  const fontAssetPaths = await listRuntimeAssetFiles(fontRoot, fontRoot)
  const assetPaths = [
    ...(entry.requiredAssets.js ?? []),
    ...(entry.requiredAssets.css ?? []),
    'reset.css',
    ...fontAssetPaths.map((assetPath) =>
      path.posix.join('theme/fonts', REVEAL_THEME_FONT_FAMILY, assetPath),
    ),
  ]

  entry.assets = await Promise.all(
    assetPaths.map((assetPath) => buildAssetMetadata(versionDir, assetPath)),
  )
}

async function listRuntimeAssetFiles(rootDir: string, currentDir: string): Promise<string[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        return listRuntimeAssetFiles(rootDir, entryPath)
      }

      if (!/\.(css|eot|ttf|woff2?)$/i.test(entry.name)) {
        return []
      }

      return [path.relative(rootDir, entryPath).split(path.sep).join('/')]
    }),
  )

  return files.flat().sort()
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
