import { useCallback, useEffect, useState } from 'react'

import {
  getDesktopSettings,
  updateDesktopSettings,
  type AppearancePreference,
} from '@/lib/ui/desktop-settings'

export type { AppearancePreference }
export type ResolvedAppearance = 'light' | 'dark'

const QUERY = '(prefers-color-scheme: dark)'

function resolveAppearance(preference: AppearancePreference): ResolvedAppearance {
  return preference === 'system'
    ? window.matchMedia?.(QUERY).matches
      ? 'dark'
      : 'light'
    : preference
}

export function useAppearance() {
  const [preference, setPreferenceState] = useState<AppearancePreference>(
    () => getDesktopSettings().appearance,
  )
  const [resolvedAppearance, setResolvedAppearance] = useState<ResolvedAppearance>(() =>
    resolveAppearance(preference),
  )

  useEffect(() => {
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

  const setPreference = useCallback((next: AppearancePreference) => {
    setPreferenceState(next)
    void updateDesktopSettings({ appearance: next })
  }, [])

  return { preference, resolvedAppearance, setPreference }
}
