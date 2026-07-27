import { useEffect, useState } from 'react'

export type AppearancePreference = 'system' | 'light' | 'dark'
export type ResolvedAppearance = 'light' | 'dark'

const STORAGE_KEY = 'ark:appearance'
const QUERY = '(prefers-color-scheme: dark)'

function readPreference(): AppearancePreference {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

function resolveAppearance(preference: AppearancePreference): ResolvedAppearance {
  return preference === 'system'
    ? window.matchMedia?.(QUERY).matches
      ? 'dark'
      : 'light'
    : preference
}

export function useAppearance() {
  const [preference, setPreference] = useState<AppearancePreference>(readPreference)
  const [resolvedAppearance, setResolvedAppearance] = useState<ResolvedAppearance>(() =>
    resolveAppearance(preference),
  )

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, preference)
    const media = window.matchMedia?.(QUERY)
    const apply = () => {
      const resolved = preference === 'system' ? (media?.matches ? 'dark' : 'light') : preference
      setResolvedAppearance(resolved)
      document.documentElement.classList.toggle('dark', resolved === 'dark')
    }

    apply()
    if (preference === 'system') media?.addEventListener('change', apply)
    return () => media?.removeEventListener('change', apply)
  }, [preference])

  return { preference, resolvedAppearance, setPreference }
}
