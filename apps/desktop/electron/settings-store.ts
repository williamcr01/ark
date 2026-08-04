import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { ReasoningEffort } from '@ark/contracts'

export type AppearancePreference = 'system' | 'light' | 'dark'

export type DesktopSettings = {
  appearance: AppearancePreference
  migratedLegacyRendererPreferences: boolean
  reasoningEffortByModel: Record<string, ReasoningEffort>
  selectedModel: string | null
  defaultWorkspaceDirectory: string | null
}

type SettingsFile = DesktopSettings & { version: 1 }

const reasoningEfforts = new Set<ReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

const DEFAULT_SETTINGS: DesktopSettings = {
  appearance: 'system',
  migratedLegacyRendererPreferences: false,
  reasoningEffortByModel: {},
  selectedModel: null,
  defaultWorkspaceDirectory: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseAppearance(value: unknown): AppearancePreference {
  return value === 'light' || value === 'dark' ? value : 'system'
}

function parseSelectedModel(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 1_000 ? value : null
}

function parseWorkspaceDirectory(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 4_096 ? value : null
}

function parseReasoningEfforts(value: unknown): Record<string, ReasoningEffort> {
  if (!isRecord(value)) return {}

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 200)
      .filter(
        (entry): entry is [string, ReasoningEffort] =>
          entry[0].length <= 1_000 && reasoningEfforts.has(entry[1] as ReasoningEffort),
      ),
  )
}

function parseSettings(value: unknown): DesktopSettings {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS }

  return {
    appearance: parseAppearance(value.appearance),
    migratedLegacyRendererPreferences: value.migratedLegacyRendererPreferences === true,
    reasoningEffortByModel: parseReasoningEfforts(value.reasoningEffortByModel),
    selectedModel: parseSelectedModel(value.selectedModel),
    defaultWorkspaceDirectory: parseWorkspaceDirectory(value.defaultWorkspaceDirectory),
  }
}

function parsePatch(value: unknown): Partial<DesktopSettings> {
  if (!isRecord(value)) throw new Error('Invalid settings update.')

  const patch: Partial<DesktopSettings> = {}
  if ('appearance' in value) {
    if (!['system', 'light', 'dark'].includes(String(value.appearance))) {
      throw new Error('Invalid appearance preference.')
    }
    patch.appearance = value.appearance as AppearancePreference
  }
  if ('migratedLegacyRendererPreferences' in value) {
    if (typeof value.migratedLegacyRendererPreferences !== 'boolean') {
      throw new Error('Invalid settings migration state.')
    }
    patch.migratedLegacyRendererPreferences = value.migratedLegacyRendererPreferences
  }
  if ('selectedModel' in value) {
    if (
      value.selectedModel !== null &&
      (typeof value.selectedModel !== 'string' || value.selectedModel.length > 1_000)
    ) {
      throw new Error('Invalid selected model.')
    }
    patch.selectedModel = value.selectedModel
  }
  if ('defaultWorkspaceDirectory' in value) {
    if (
      value.defaultWorkspaceDirectory !== null &&
      (typeof value.defaultWorkspaceDirectory !== 'string' ||
        value.defaultWorkspaceDirectory.length > 4_096)
    )
      throw new Error('Invalid workspace directory.')
    patch.defaultWorkspaceDirectory = value.defaultWorkspaceDirectory
  }
  if ('reasoningEffortByModel' in value) {
    const parsed = parseReasoningEfforts(value.reasoningEffortByModel)
    if (
      !isRecord(value.reasoningEffortByModel) ||
      Object.keys(parsed).length !== Object.keys(value.reasoningEffortByModel).length
    ) {
      throw new Error('Invalid reasoning effort preferences.')
    }
    patch.reasoningEffortByModel = parsed
  }

  return patch
}

export class DesktopSettingsStore {
  private readonly filePath: string
  private settings: DesktopSettings = { ...DEFAULT_SETTINGS }
  private writeQueue = Promise.resolve()

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const file = JSON.parse(raw) as SettingsFile
      if (file.version === 1) this.settings = parseSettings(file)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return
      // Preserve corrupt files and use safe defaults.
    }
  }

  get() {
    return structuredClone(this.settings)
  }

  async update(rawPatch: unknown) {
    const patch = parsePatch(rawPatch)
    let result = this.get()

    const operation = this.writeQueue.then(async () => {
      const next = { ...this.settings, ...patch }
      await this.persist(next)
      this.settings = next
      result = this.get()
    })
    this.writeQueue = operation.catch(() => undefined)

    await operation
    return result
  }

  private async persist(settings: DesktopSettings) {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    await writeFile(
      temporaryPath,
      JSON.stringify({ version: 1, ...settings } satisfies SettingsFile, null, 2),
      { encoding: 'utf8', mode: 0o600 },
    )
    await rename(temporaryPath, this.filePath)
  }
}
