import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { createPostgresDeckStore } from './db/repositories/decks.ts'
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

function migrateLegacyDeck(parsed: StoredDeck): StoredDeckFile | null {
  if (
    typeof parsed.id !== 'string' ||
    typeof parsed.html !== 'string' ||
    typeof parsed.createdAt !== 'string' ||
    typeof parsed.updatedAt !== 'string'
  ) {
    return null
  }

  const title = normalizeDeckTitle(
    typeof parsed.title === 'string' ? parsed.title : extractDeckTitle(parsed.html),
  )
  const versionId = parsed.activeVersionId ?? randomUUID()

  return {
    id: parsed.id,
    title,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    activeVersionId: versionId,
    versions: [
      {
        id: versionId,
        versionNumber: parsed.versionNumber ?? 1,
        html: parsed.html,
        title,
        source: 'manual',
        summary: null,
        validationStatus: 'valid',
        runtimeManifest: null,
        createdAt: parsed.createdAt,
      },
    ],
  }
}

function parseDeckFile(raw: string): StoredDeckFile | null {
  const parsed = JSON.parse(raw) as StoredDeck & StoredDeckFile

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

  return migrateLegacyDeck(parsed)
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
  await writeFile(filePath, JSON.stringify(file), 'utf8')
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
    summary: options.summary ?? null,
    validationStatus: normalizeDeckValidationStatus(options.validationStatus ?? 'valid'),
    runtimeManifest: resolveVersionManifest(html, options),
    createdAt,
  }
}

export function createDeckStore(dataDir = DEFAULT_DATA_DIR): DeckStore {
  const createDeck = async (html: string, options: DeckVersionOptions = {}) => {
    await ensureDataDir(dataDir)

    const now = new Date().toISOString()
    const deckId = randomUUID()
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

    await writeDeckFile(filePath, file)

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

    const file = await readDeckFile(filePath)

    return file ? toStoredDeck(file) : null
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

            const file = await readDeckFile(filePath)

            if (!file) {
              return null
            }

            const deck = toStoredDeck(file)

            if (!deck) {
              return null
            }

            const summary: DeckSummary = {
              id: deck.id,
              title: deck.title,
              createdAt: deck.createdAt,
              updatedAt: deck.updatedAt,
              activeVersionId: deck.activeVersionId,
              versionNumber: deck.versionNumber,
            }

            return summary
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

    await writeDeckFile(filePath, updated)

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

    await writeDeckFile(filePath, updated)

    return toStoredDeck(updated)
  }

  const deleteDeck = async (id: string) => {
    const filePath = resolveDeckPath(dataDir, id)

    if (!filePath) {
      return false
    }

    try {
      await unlink(filePath)
      return true
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
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

    const file = await readDeckFile(filePath)

    if (!file) {
      return null
    }

    return [...file.versions]
      .sort((left, right) => right.versionNumber - left.versionNumber)
      .map((version) => toVersionSummary(deckId, version, file.activeVersionId))
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

  const rollbackToVersion = async (deckId: string, versionId: string) => {
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
    getVersion,
    rollbackToVersion,
  }
}

export function createDefaultDeckStore(env = process.env): DeckStore {
  if (env.DATABASE_URL?.trim()) {
    return createPostgresDeckStore()
  }

  return createDeckStore()
}

export const deckStore = createDefaultDeckStore()
