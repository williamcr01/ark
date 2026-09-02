import { useEffect, useState } from 'react'

import { type AppearancePreference } from '@/lib/ui/desktop-settings'
import { useShellStore } from '@/state/shell-store.ts'

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
  useState(() => {
    useShellStore.getState().syncFromDesktopSettings()
    return true
  })

  const preference = useShellStore((state) => state.appearancePreference)
  const setPreference = useShellStore((state) => state.setAppearancePreference)
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

  return { preference, resolvedAppearance, setPreference }
}
