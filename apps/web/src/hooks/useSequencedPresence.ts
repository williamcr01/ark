import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Keeps the active item mounted for its exit animation and queues a replacement
 * until that exit completes.
 */
export function useSequencedPresence<T>(exitFallbackMs = 200) {
  const [active, setActive] = useState<T | null>(null)
  const [closing, setClosing] = useState(false)
  const pendingRef = useRef<T | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const completeExit = useCallback(() => {
    clearTimer()
    const pending = pendingRef.current
    pendingRef.current = null
    setClosing(false)
    setActive(pending)
  }, [clearTimer])

  const beginExit = useCallback(() => {
    setClosing(true)
    clearTimer()
    timerRef.current = window.setTimeout(completeExit, exitFallbackMs)
  }, [clearTimer, completeExit, exitFallbackMs])

  const hide = useCallback(() => {
    pendingRef.current = null
    if (active !== null && !closing) {
      beginExit()
    }
  }, [active, beginExit, closing])

  const show = useCallback(
    (next: T) => {
      if (active === null) {
        setActive(next)
        setClosing(false)
        return
      }

      pendingRef.current = next
      if (!closing) {
        beginExit()
      }
    },
    [active, beginExit, closing],
  )

  const reset = useCallback(() => {
    clearTimer()
    pendingRef.current = null
    setActive(null)
    setClosing(false)
  }, [clearTimer])

  useEffect(() => clearTimer, [clearTimer])

  return {
    active,
    completeExit,
    hide,
    reset,
    show,
    state: closing ? ('closed' as const) : ('open' as const),
  }
}
