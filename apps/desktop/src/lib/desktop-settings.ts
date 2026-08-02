import type { ReasoningEffort } from '@ark/contracts'

export type AppearancePreference = 'system' | 'light' | 'dark'

export type DesktopSettings = {
  appearance: AppearancePreference
  migratedLegacyRendererPreferences: boolean
  reasoningEffortByModel: Record<string, ReasoningEffort>
  selectedModel: string | null
}

const APPEARANCE_KEY = 'ark:appearance'
const MODEL_KEY = 'ark:selected-model'
const REASONING_KEY = 'ark:reasoning-effort-by-model:v1'
const reasoningEfforts = new Set<ReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

const defaults = (): DesktopSettings => ({
  appearance: 'system',
  migratedLegacyRendererPreferences: false,
  reasoningEffortByModel: {},
  selectedModel: null,
})

let current = defaults()

function readLegacySettings(): Partial<DesktopSettings> {
  const patch: Partial<DesktopSettings> = {}
  const appearance = localStorage.getItem(APPEARANCE_KEY)
  const selectedModel = localStorage.getItem(MODEL_KEY)

  if (appearance === 'system' || appearance === 'light' || appearance === 'dark') {
    patch.appearance = appearance
  }
  if (selectedModel) patch.selectedModel = selectedModel

  try {
    const reasoning = JSON.parse(localStorage.getItem(REASONING_KEY) ?? '{}') as Record<
      string,
      unknown
    >
    if (reasoning && typeof reasoning === 'object' && !Array.isArray(reasoning)) {
      patch.reasoningEffortByModel = Object.fromEntries(
        Object.entries(reasoning).filter((entry): entry is [string, ReasoningEffort] =>
          reasoningEfforts.has(entry[1] as ReasoningEffort),
        ),
      )
    }
  } catch {
    // Ignore invalid legacy preferences.
  }

  return patch
}

export async function initializeDesktopSettings() {
  current = await window.arkDesktop.settings.get()

  if (!current.migratedLegacyRendererPreferences) {
    current = await window.arkDesktop.settings.update({
      ...readLegacySettings(),
      migratedLegacyRendererPreferences: true,
    })
    localStorage.removeItem(APPEARANCE_KEY)
    localStorage.removeItem(MODEL_KEY)
    localStorage.removeItem(REASONING_KEY)
  }
}

export function getDesktopSettings() {
  return current
}

export function updateDesktopSettings(patch: Partial<DesktopSettings>) {
  current = { ...current, ...patch }
  return window.arkDesktop.settings.update(patch).catch(() => current)
}

export function resetDesktopSettingsForTests(settings: Partial<DesktopSettings> = {}) {
  current = { ...defaults(), ...settings }
}
