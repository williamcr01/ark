import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { createPostgresDeckStore } from './db/repositories/decks.ts'
import {
  type DeckStore,
  type DeckSummary,
  type StoredDeck,
  extractDeckTitle,
  isValidDeckId,
} from './deck-record.ts'

export { extractDeckTitle, isValidDeckId }
export type { DeckStore, DeckSummary, StoredDeck }

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data', 'decks')

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

async function readDeckFile(filePath: string): Promise<StoredDeck | null> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as StoredDeck

    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.html !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.updatedAt !== 'string'
    ) {
      return null
    }

    return {
      ...parsed,
      title: typeof parsed.title === 'string' ? parsed.title : extractDeckTitle(parsed.html),
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

export function createDeckStore(dataDir = DEFAULT_DATA_DIR): DeckStore {
  const createDeck = async (html: string) => {
    await ensureDataDir(dataDir)

    const now = new Date().toISOString()
    const deck: StoredDeck = {
      id: randomUUID(),
      html,
      title: extractDeckTitle(html),
      createdAt: now,
      updatedAt: now,
    }

    const filePath = resolveDeckPath(dataDir, deck.id)

    if (!filePath) {
      throw new Error('Generated deck id is invalid.')
    }

    await writeFile(filePath, JSON.stringify(deck), 'utf8')

    return deck
  }

  const getDeck = async (id: string) => {
    const filePath = resolveDeckPath(dataDir, id)

    if (!filePath) {
      return null
    }

    return readDeckFile(filePath)
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

            const deck = await readDeckFile(filePath)

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

  const updateDeck = async (id: string, html: string) => {
    const filePath = resolveDeckPath(dataDir, id)

    if (!filePath) {
      return null
    }

    const existing = await readDeckFile(filePath)

    if (!existing) {
      return null
    }

    const updated: StoredDeck = {
      ...existing,
      html,
      title: extractDeckTitle(html),
      updatedAt: new Date().toISOString(),
    }

    await writeFile(filePath, JSON.stringify(updated), 'utf8')

    return updated
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

  return {
    createDeck,
    getDeck,
    listDecks,
    updateDeck,
    deleteDeck,
  }
}

export function createDefaultDeckStore(env = process.env): DeckStore {
  if (env.DATABASE_URL?.trim()) {
    return createPostgresDeckStore()
  }

  return createDeckStore()
}

export const deckStore = createDefaultDeckStore()
