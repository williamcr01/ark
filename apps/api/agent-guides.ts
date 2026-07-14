import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { REPO_ROOT } from './repo-root.ts'

export const DEFAULT_AGENT_GUIDES_MAX_BYTES = 131_072

export type AgentGuideSection = {
  id: string
  content: string
  bytes: number
}

export type AgentGuidesLoadResult = {
  sections: AgentGuideSection[]
  totalBytes: number
  truncated: boolean
  directory: string
}

type CacheEntry = {
  directory: string
  maxBytes: number
  mtimes: Record<string, number>
  result: AgentGuidesLoadResult
}

let cache: CacheEntry | null = null

const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength

function resolveAgentGuidesDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ARK_AGENT_GUIDES_DIR?.trim()
  if (override) return path.resolve(override)
  return path.join(REPO_ROOT, 'agent-guides')
}

function resolveMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ARK_AGENT_GUIDES_MAX_BYTES?.trim()
  if (!raw) return DEFAULT_AGENT_GUIDES_MAX_BYTES
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_AGENT_GUIDES_MAX_BYTES
  return parsed
}

function guideIdFromFilename(filename: string): string {
  const withoutExt = filename.replace(/\.md$/i, '')
  return withoutExt.replace(/^\d+[-_]?/, '') || withoutExt
}

function isEligibleGuideFilename(filename: string): boolean {
  if (!filename.toLowerCase().endsWith('.md')) return false
  if (filename.startsWith('_')) return false
  if (filename.toLowerCase() === 'readme.md') return false
  return true
}

function listGuideFilenames(directory: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(directory)
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as NodeJS.ErrnoException).code
        : undefined
    if (code === 'ENOENT') return []
    throw error
  }

  return entries.filter(isEligibleGuideFilename).sort((a, b) => a.localeCompare(b))
}

function readGuideMtimes(directory: string, filenames: readonly string[]): Record<string, number> {
  const mtimes: Record<string, number> = {}
  for (const filename of filenames) {
    try {
      mtimes[filename] = statSync(path.join(directory, filename)).mtimeMs
    } catch {
      mtimes[filename] = -1
    }
  }
  return mtimes
}

function mtimesEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every((key) => a[key] === b[key])
}

function stripOptionalFrontmatter(raw: string): string {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return raw.trim()
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return raw.trim()
  return match[1].trim()
}

function utf8Prefix(value: string, maxBytes: number): string {
  let prefix = ''
  let used = 0
  for (const character of value) {
    const size = utf8Bytes(character)
    if (used + size > Math.max(0, maxBytes)) break
    prefix += character
    used += size
  }
  return prefix
}

function readSections(directory: string, filenames: readonly string[]): AgentGuideSection[] {
  const sections: AgentGuideSection[] = []
  for (const filename of filenames) {
    const raw = readFileSync(path.join(directory, filename), 'utf8')
    const body = stripOptionalFrontmatter(raw)
    if (!body) continue
    const id = guideIdFromFilename(filename)
    sections.push({ id, content: body, bytes: utf8Bytes(body) })
  }
  return sections
}

function formatSections(sections: readonly AgentGuideSection[]): string {
  return sections.map((section) => `## Guide: ${section.id}\n\n${section.content}`).join('\n\n')
}

function applyMaxBytes(
  sections: AgentGuideSection[],
  maxBytes: number,
): { sections: AgentGuideSection[]; truncated: boolean; totalBytes: number } {
  if (maxBytes === 0) {
    return { sections: [], truncated: sections.length > 0, totalBytes: 0 }
  }

  const kept: AgentGuideSection[] = []
  let totalBytes = 0
  let truncated = false

  for (const section of sections) {
    const header = `## Guide: ${section.id}\n\n`
    const headerBytes = utf8Bytes(header)
    const separatorBytes = kept.length > 0 ? utf8Bytes('\n\n') : 0
    const remaining = maxBytes - totalBytes - separatorBytes - headerBytes

    if (remaining <= 0) {
      truncated = true
      break
    }

    if (section.bytes <= remaining) {
      kept.push(section)
      totalBytes += separatorBytes + headerBytes + section.bytes
      continue
    }

    const marker = '\n\n[agent guide truncated]'
    const markerBytes = utf8Bytes(marker)
    const contentBudget = Math.max(0, remaining - markerBytes)
    const truncatedContent =
      contentBudget > 0 ? `${utf8Prefix(section.content, contentBudget)}${marker}` : marker.trim()
    kept.push({
      id: section.id,
      content: truncatedContent,
      bytes: utf8Bytes(truncatedContent),
    })
    totalBytes += separatorBytes + headerBytes + utf8Bytes(truncatedContent)
    truncated = true
    break
  }

  if (kept.length < sections.length) truncated = true

  return { sections: kept, truncated, totalBytes }
}

function loadFromDisk(
  directory: string,
  maxBytes: number,
  filenames: readonly string[],
): AgentGuidesLoadResult {
  const sections = readSections(directory, filenames)
  const applied = applyMaxBytes(sections, maxBytes)
  if (applied.truncated) {
    console.warn(
      `[agent-guides] Concatenated guides exceeded ${maxBytes} bytes; truncated for prompt safety.`,
    )
  }
  return {
    sections: applied.sections,
    totalBytes: applied.totalBytes,
    truncated: applied.truncated,
    directory,
  }
}

/** Clears the in-memory guide cache (for tests). */
export function resetAgentGuidesCache(): void {
  cache = null
}

export function loadAgentGuides(options?: {
  env?: NodeJS.ProcessEnv
  /** When true, always re-read from disk (tests). */
  forceReload?: boolean
}): AgentGuidesLoadResult {
  const env = options?.env ?? process.env
  const directory = resolveAgentGuidesDir(env)
  const maxBytes = resolveMaxBytes(env)
  const filenames = listGuideFilenames(directory)
  const mtimes = readGuideMtimes(directory, filenames)
  const isProduction = (env.NODE_ENV ?? process.env.NODE_ENV) === 'production'
  const canUseCache =
    !options?.forceReload &&
    cache &&
    cache.directory === directory &&
    cache.maxBytes === maxBytes &&
    (isProduction || mtimesEqual(cache.mtimes, mtimes))

  if (canUseCache && cache) {
    return cache.result
  }

  const result = loadFromDisk(directory, maxBytes, filenames)
  cache = { directory, maxBytes, mtimes, result }
  return result
}

export function buildAgentGuidesPromptSection(options?: {
  env?: NodeJS.ProcessEnv
  forceReload?: boolean
}): string {
  const { sections } = loadAgentGuides(options)
  if (!sections.length) return ''
  return formatSections(sections)
}

export function getAgentGuidesMetadata(options?: {
  env?: NodeJS.ProcessEnv
  forceReload?: boolean
}): {
  guideCount: number
  guideBytes: number
  guidesTruncated: boolean
} {
  const loaded = loadAgentGuides(options)
  return {
    guideCount: loaded.sections.length,
    guideBytes: loaded.totalBytes,
    guidesTruncated: loaded.truncated,
  }
}

/** Test helpers — exposed for unit tests without re-exporting internals elsewhere. */
export const agentGuidesTestUtils = {
  isEligibleGuideFilename,
  guideIdFromFilename,
  formatSections,
  applyMaxBytes,
  stripOptionalFrontmatter,
}
