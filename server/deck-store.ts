import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export type StoredDeck = {
  id: string
  html: string
  title: string
  createdAt: string
  updatedAt: string
}

export type DeckStore = {
  createDeck: (html: string) => Promise<StoredDeck>
  getDeck: (id: string) => Promise<StoredDeck | null>
  updateDeck: (id: string, html: string) => Promise<StoredDeck | null>
  deleteDeck: (id: string) => Promise<boolean>
}

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data', 'decks')

const DECK_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidDeckId(id: string) {
  return DECK_ID_PATTERN.test(id)
}

export function extractDeckTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const title = match?.[1]?.trim()

  return title || 'Untitled deck'
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
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
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
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return false
      }

      throw error
    }
  }

  return {
    createDeck,
    getDeck,
    updateDeck,
    deleteDeck,
  }
}

export const deckStore = createDeckStore()
