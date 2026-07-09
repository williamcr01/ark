import { useEffect, useState, type RefObject } from 'react'

export type FrameNavigationGuardOptions = {
  /**
   * When false, the guard does not attach listeners and reports not compromised.
   * Use to disable for empty/disabled previews.
   */
  enabled?: boolean
}

export type FrameNavigationGuardResult = {
  /** True after an unexpected second `load` on the same iframe key. */
  compromised: boolean
}

type LoadTracker = {
  key: string
  count: number
  compromised: boolean
}

/**
 * Detect unexpected iframe self-navigation.
 *
 * Shell-triggered reloads remount the iframe via `key={iframeKey}` (new preview
 * session / HTML change), so each key gets exactly one expected `load`. A second
 * `load` on the same key means the frame navigated itself (e.g. `location.href =
 * ...` in full-JS mode) — treat as hostile.
 */
export function useFrameNavigationGuard(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  iframeKey: string,
  options: FrameNavigationGuardOptions = {},
): FrameNavigationGuardResult {
  const enabled = options.enabled ?? true
  const [tracker, setTracker] = useState<LoadTracker>({
    key: iframeKey,
    count: 0,
    compromised: false,
  })

  // Reset load counting when the shell remounts the iframe (new key).
  // Mirrors the generation-key pattern in useDeckEditorBridge.
  if (tracker.key !== iframeKey) {
    setTracker({ key: iframeKey, count: 0, compromised: false })
  }

  useEffect(() => {
    if (!enabled) {
      return
    }

    const iframe = iframeRef.current

    if (!iframe) {
      return
    }

    const handleLoad = () => {
      setTracker((current) => {
        if (current.key !== iframeKey || current.compromised) {
          return current
        }

        const nextCount = current.count + 1

        if (nextCount > 1) {
          return { key: iframeKey, count: nextCount, compromised: true }
        }

        return { key: iframeKey, count: nextCount, compromised: false }
      })
    }

    iframe.addEventListener('load', handleLoad)

    return () => {
      iframe.removeEventListener('load', handleLoad)
    }
  }, [enabled, iframeKey, iframeRef])

  return {
    compromised: enabled && tracker.key === iframeKey && tracker.compromised,
  }
}
