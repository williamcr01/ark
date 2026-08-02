import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import type { DeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'
import { parseDeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'
import { buildDeckRuntimeManifestFromHtml } from './deck-manifest.ts'
import {
  type DeckStore,
  type DeckSummary,
  type DeckValidationStatus,
  type DeckVersionDetail,
  type DeckVersionOptions,
  type DeckVersionSource,
  type DeckVersionSummary,
  type StoredDeck,
  extractDeckTitle,
  isValidDeckId,
  normalizeDeckTitle,
  normalizeDeckValidationStatus,
  normalizeDeckVersionSource,
} from './deck-record.ts'
import {
  deckVersionSummarySchema,
  normalizeDeckVersionDiff,
  normalizeDeckVersionProvenance,
  storedDeckSchema,
  truncateDeckVersionSummary,
  type DeckVersionDiff,
  type DeckVersionProvenance,
} from '@ark/contracts'
import { REPO_ROOT } from './repo-root.ts'

export {
  extractDeckTitle,
  isValidDeckId,
  normalizeDeckTitle,
  normalizeDeckValidationStatus,
  normalizeDeckVersionSource,
}
export type {
  DeckStore,
  DeckSummary,
  DeckValidationStatus,
  DeckVersionDetail,
  DeckVersionOptions,
  DeckVersionSource,
  DeckVersionSummary,
  StoredDeck,
}

const DEFAULT_DATA_DIR = path.resolve(REPO_ROOT, 'data', 'decks')

type StoredDeckVersion = {
  id: string
  versionNumber: number
  html: string
  title: string
  source: DeckVersionSource
  summary: string | null
  modelProvider: string | null
  modelName: string | null
  provenance: DeckVersionProvenance | null
  diff: DeckVersionDiff | null
  validationStatus: DeckValidationStatus
  runtimeManifest: DeckRuntimeManifest | null
  createdAt: string
}

type StoredDeckFile = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  activeVersionId: string
  versions: StoredDeckVersion[]
}

type DeckMetadataIndex = {
  mtimeMs: number
  size: number
  versions: Map<string, DeckVersionSummary>
}

type ActiveDeckSnapshot = {
  sourceMtimeMs: number
  sourceSize: number
  deck: StoredDeck
  versions: DeckVersionSummary[]
}

function resolveDeckPath(dataDir: string, id: string) {
  if (!isValidDeckId(id)) {
    return null
  }

  const resolvedDataDir = path.resolve(dataDir)
  const resolvedPath = path.resolve(resolvedDataDir, `${id}.json`)
  const dataDirPrefix = resolvedDataDir.endsWith(path.sep)
    ? resolvedDataDir
    : `${resolvedDataDir}${path.sep}`

  if (!resolvedPath.startsWith(dataDirPrefix)) {
    return null
  }

  return resolvedPath
}

async function ensureDataDir(dataDir: string) {
  await mkdir(dataDir, { recursive: true })
}

function toVersionSummary(
  deckId: string,
  version: StoredDeckVersion,
  activeVersionId: string,
): DeckVersionSummary {
  return {
    id: version.id,
    deckId,
    versionNumber: version.versionNumber,
    title: version.title,
    source: version.source,
    summary: version.summary,
    modelProvider: version.modelProvider,
    modelName: version.modelName,
    provenance: version.provenance,
    diff: version.diff,
    validationStatus: version.validationStatus,
    runtimeManifest: version.runtimeManifest,
    createdAt: version.createdAt,
    isActive: version.id === activeVersionId,
  }
}

function toVersionDetail(
  deckId: string,
  version: StoredDeckVersion,
  activeVersionId: string,
): DeckVersionDetail {
  return {
    ...toVersionSummary(deckId, version, activeVersionId),
    html: version.html,
  }
}

function toStoredDeck(file: StoredDeckFile): StoredDeck | null {
  const activeVersion = file.versions.find((version) => version.id === file.activeVersionId)

  if (!activeVersion) {
    return null
  }

  return {
    id: file.id,
    html: activeVersion.html,
    title: file.title,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    activeVersionId: file.activeVersionId,
    versionNumber: activeVersion.versionNumber,
  }
}

function parseDeckFile(raw: string): StoredDeckFile | null {
  const parsed = JSON.parse(raw) as StoredDeckFile

  if (Array.isArray(parsed.versions) && typeof parsed.activeVersionId === 'string') {
    const versions = parsed.versions
      .filter(
        (version): version is StoredDeckVersion =>
          typeof version === 'object' &&
          version !== null &&
          typeof version.id === 'string' &&
          typeof version.versionNumber === 'number' &&
          typeof version.html === 'string' &&
          typeof version.title === 'string' &&
          typeof version.createdAt === 'string',
      )
      .map((version) => ({
        id: version.id,
        versionNumber: version.versionNumber,
        html: version.html,
        title: normalizeDeckTitle(version.title),
        source: normalizeDeckVersionSource(version.source),
        summary: typeof version.summary === 'string' ? version.summary : null,
        modelProvider: typeof version.modelProvider === 'string' ? version.modelProvider : null,
        modelName: typeof version.modelName === 'string' ? version.modelName : null,
        provenance: normalizeDeckVersionProvenance(version.provenance),
        diff: normalizeDeckVersionDiff(version.diff),
        validationStatus: normalizeDeckValidationStatus(version.validationStatus),
        runtimeManifest: parseDeckRuntimeManifest(version.runtimeManifest),
        createdAt: version.createdAt,
      }))

    if (versions.length === 0) {
      return null
    }

    return {
      id: parsed.id,
      title: normalizeDeckTitle(parsed.title),
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      activeVersionId: parsed.activeVersionId,
      versions,
    }
  }

  return null
}

async function readDeckFile(filePath: string): Promise<StoredDeckFile | null> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return parseDeckFile(raw)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

async function writeDeckFile(filePath: string, file: StoredDeckFile) {
  const tempPath = `${filePath}.${randomUUID()}.tmp`

  try {
    await writeFile(tempPath, JSON.stringify(file), 'utf8')
    await rename(tempPath, filePath)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}

function resolveActiveDeckSnapshotPath(filePath: string) {
  return `${filePath}.active`
}

async function readActiveDeckSnapshot(filePath: string): Promise<ActiveDeckSnapshot | null> {
  try {
    const [fileStat, raw] = await Promise.all([
      stat(filePath),
      readFile(resolveActiveDeckSnapshotPath(filePath), 'utf8'),
    ])
    const parsed = JSON.parse(raw) as ActiveDeckSnapshot

    if (parsed.sourceMtimeMs !== fileStat.mtimeMs || parsed.sourceSize !== fileStat.size) {
      return null
    }

    const deck = storedDeckSchema.safeParse(parsed.deck)
    const versions = deckVersionSummarySchema.array().safeParse(parsed.versions)

    if (!deck.success || !versions.success) {
      return null
    }

    return { ...parsed, deck: deck.data, versions: versions.data }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }

    if (error instanceof SyntaxError) {
      return null
    }

    throw error
  }
}

async function writeActiveDeckSnapshot(filePath: string, file: StoredDeckFile) {
  const deck = toStoredDeck(file)

  if (!deck) {
    return
  }

  const fileStat = await stat(filePath)

  const snapshot: ActiveDeckSnapshot = {
    sourceMtimeMs: fileStat.mtimeMs,
    sourceSize: fileStat.size,
    deck,
    versions: file.versions.map((version) =>
      toVersionSummary(file.id, version, file.activeVersionId),
    ),
  }
  const snapshotPath = resolveActiveDeckSnapshotPath(filePath)
  const tempPath = `${snapshotPath}.${randomUUID()}.tmp`

  try {
    await writeFile(tempPath, JSON.stringify(snapshot), 'utf8')
    await rename(tempPath, snapshotPath)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}

async function writeDeckFileWithSnapshot(filePath: string, file: StoredDeckFile) {
  await writeDeckFile(filePath, file)
  await writeActiveDeckSnapshot(filePath, file)
}

function resolveVersionManifest(html: string, options: DeckVersionOptions = {}) {
  return options.runtimeManifest ?? buildDeckRuntimeManifestFromHtml(html)
}

function createVersion(
  versionNumber: number,
  html: string,
  title: string,
  createdAt: string,
  options: DeckVersionOptions = {},
): StoredDeckVersion {
  return {
    id: randomUUID(),
    versionNumber,
    html,
    title,
    source: normalizeDeckVersionSource(options.source),
    summary:
      typeof options.summary === 'string' ? truncateDeckVersionSummary(options.summary) : null,
    modelProvider: options.modelProvider ?? null,
    modelName: options.modelName ?? null,
    provenance: normalizeDeckVersionProvenance(options.provenance),
    diff: normalizeDeckVersionDiff(options.diff),
    validationStatus: normalizeDeckValidationStatus(options.validationStatus ?? 'valid'),
    runtimeManifest: resolveVersionManifest(html, options),
    createdAt,
  }
}

export function createDeckStore(dataDir = DEFAULT_DATA_DIR): DeckStore {
  const metadataIndex = new Map<string, DeckMetadataIndex>()

  const invalidateMetadataIndex = (filePath: string | null) => {
    if (filePath) {
      metadataIndex.delete(filePath)
    }
  }

  const readVersionMetadataIndex = async (filePath: string): Promise<DeckMetadataIndex | null> => {
    let fileStat: Awaited<ReturnType<typeof stat>>

    try {
      fileStat = await stat(filePath)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        metadataIndex.delete(filePath)
        return null
      }

      throw error
    }

    const cached = metadataIndex.get(filePath)

    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
      return cached
    }

    const snapshot = await readActiveDeckSnapshot(filePath)

    if (snapshot) {
      const nextIndex: DeckMetadataIndex = {
        mtimeMs: snapshot.sourceMtimeMs,
        size: snapshot.sourceSize,
        versions: new Map(snapshot.versions.map((version) => [version.id, version])),
      }

      metadataIndex.set(filePath, nextIndex)
      return nextIndex
    }

    metadataIndex.delete(filePath)
    return null
  }

  const createDeck = async (
    html: string,
    options: DeckVersionOptions = {},
    requestedId?: string,
  ) => {
    await ensureDataDir(dataDir)

    const now = new Date().toISOString()
    const deckId = requestedId ?? randomUUID()
    if (!isValidDeckId(deckId)) throw new Error('Requested deck id is invalid.')
    const title = extractDeckTitle(html)
    const version = createVersion(1, html, title, now, options)
    const file: StoredDeckFile = {
      id: deckId,
      title,
      createdAt: now,
      updatedAt: now,
      activeVersionId: version.id,
      versions: [version],
    }

    const filePath = resolveDeckPath(dataDir, deckId)

    if (!filePath) {
      throw new Error('Generated deck id is invalid.')
    }

    await writeDeckFileWithSnapshot(filePath, file)
    invalidateMetadataIndex(filePath)

    const deck = toStoredDeck(file)

    if (!deck) {
      throw new Error('Created deck could not be loaded from file store.')
    }

    return deck
  }

  const getDeck = async (id: string) => {
    const filePath = resolveDeckPath(dataDir, id)

    if (!filePath) {
      return null
    }

    return (await readActiveDeckSnapshot(filePath))?.deck ?? null
  }

  const listDecks = async () => {
    try {
      const entries = await readdir(dataDir, { withFileTypes: true })
      const decks = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map(async (entry) => {
            const id = entry.name.replace(/\.json$/i, '')
            const filePath = resolveDeckPath(dataDir, id)

            if (!filePath) {
              return null
            }

            const snapshot = await readActiveDeckSnapshot(filePath)

            if (snapshot) {
              const summary: DeckSummary = {
                id: snapshot.deck.id,
                title: snapshot.deck.title,
                createdAt: snapshot.deck.createdAt,
                updatedAt: snapshot.deck.updatedAt,
                activeVersionId: snapshot.deck.activeVersionId,
                versionNumber: snapshot.deck.versionNumber,
              }

              return summary
            }

            return null
          }),
      )

      return decks
        .filter((deck): deck is DeckSummary => Boolean(deck))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return []
      }

      throw error
    }
  }

  const updateDeck = async (id: string, html: string, options: DeckVersionOptions = {}) => {
    const filePath = resolveDeckPath(dataDir, id)

    if (!filePath) {
      return null
    }

    const existing = await readDeckFile(filePath)

    if (!existing) {
      return null
    }

    const activeVersion = existing.versions.find(
      (version) => version.id === existing.activeVersionId,
    )
    const nextVersionNumber =
      existing.versions.reduce((max, version) => Math.max(max, version.versionNumber), 0) + 1
    const updatedAt = new Date().toISOString()
    const title =
      existing.title === extractDeckTitle(activeVersion?.html ?? '')
        ? extractDeckTitle(html)
        : existing.title
    const version = createVersion(nextVersionNumber, html, title, updatedAt, options)
    const updated: StoredDeckFile = {
      ...existing,
      title,
      updatedAt,
      activeVersionId: version.id,
      versions: [...existing.versions, version],
    }

    await writeDeckFileWithSnapshot(filePath, updated)
    invalidateMetadataIndex(filePath)

    return toStoredDeck(updated)
  }

  const updateDeckMetadata = async (id: string, metadata: { title?: string }) => {
    const filePath = resolveDeckPath(dataDir, id)

    if (!filePath) {
      return null
    }

    const existing = await readDeckFile(filePath)

    if (!existing) {
      return null
    }

    const updated: StoredDeckFile = {
      ...existing,
      title: normalizeDeckTitle(metadata.title),
      updatedAt: new Date().toISOString(),
    }

    await writeDeckFileWithSnapshot(filePath, updated)
    invalidateMetadataIndex(filePath)

    return toStoredDeck(updated)
  }

  const deleteDeck = async (id: string) => {
    const filePath = resolveDeckPath(dataDir, id)

    if (!filePath) {
      return false
    }

    try {
      await unlink(filePath)
      await unlink(resolveActiveDeckSnapshotPath(filePath)).catch(() => undefined)
      invalidateMetadataIndex(filePath)
      return true
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        invalidateMetadataIndex(filePath)
        return false
      }

      throw error
    }
  }

  const listVersions = async (deckId: string) => {
    const filePath = resolveDeckPath(dataDir, deckId)

    if (!filePath) {
      return null
    }

    const snapshot = await readActiveDeckSnapshot(filePath)
    return (
      snapshot?.versions.toSorted((left, right) => right.versionNumber - left.versionNumber) ?? null
    )
  }

  const getVersion = async (deckId: string, versionId: string) => {
    if (!isValidDeckId(versionId)) {
      return null
    }

    const filePath = resolveDeckPath(dataDir, deckId)

    if (!filePath) {
      return null
    }

    const file = await readDeckFile(filePath)

    if (!file) {
      return null
    }

    const version = file.versions.find((entry) => entry.id === versionId)

    return version ? toVersionDetail(deckId, version, file.activeVersionId) : null
  }

  const getVersionMetadata = async (deckId: string, versionId: string) => {
    if (!isValidDeckId(versionId)) {
      return null
    }

    const filePath = resolveDeckPath(dataDir, deckId)

    if (!filePath) {
      return null
    }

    const index = await readVersionMetadataIndex(filePath)

    return index?.versions.get(versionId) ?? null
  }

  const rollbackToVersion = async (
    deckId: string,
    versionId: string,
    callerOptions: DeckVersionOptions = {},
  ) => {
    if (!isValidDeckId(versionId)) {
      return null
    }

    const filePath = resolveDeckPath(dataDir, deckId)

    if (!filePath) {
      return null
    }

    const existing = await readDeckFile(filePath)

    if (!existing) {
      return null
    }

    const targetVersion = existing.versions.find((version) => version.id === versionId)

    if (!targetVersion) {
      return null
    }

    return updateDeck(deckId, targetVersion.html, {
      source: 'rollback',
      summary: `Restored from version ${targetVersion.versionNumber}`,
      validationStatus: targetVersion.validationStatus,
      runtimeManifest: targetVersion.runtimeManifest ?? undefined,
      ...callerOptions,
    })
  }

  return {
    createDeck,
    getDeck,
    listDecks,
    updateDeck,
    updateDeckMetadata,
    deleteDeck,
    listVersions,
    getVersionMetadata,
    getVersion,
    rollbackToVersion,
  }
}
