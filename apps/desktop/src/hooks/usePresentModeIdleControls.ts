import { useCallback, useEffect, useRef, useState } from 'react'

const CONTROLS_IDLE_MS = 2500

export function usePresentModeIdleControls() {
  const idleTimerRef = useRef<number | null>(null)
  const [controlsVisible, setControlsVisible] = useState(true)

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current === null) {
      return
    }

    window.clearTimeout(idleTimerRef.current)
    idleTimerRef.current = null
  }, [])

  const scheduleControlsHide = useCallback(() => {
    clearIdleTimer()

    idleTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false)
      idleTimerRef.current = null
    }, CONTROLS_IDLE_MS)
  }, [clearIdleTimer])

  const showControls = useCallback(() => {
    setControlsVisible(true)
    scheduleControlsHide()
  }, [scheduleControlsHide])

  useEffect(() => {
    scheduleControlsHide()

    return () => {
      clearIdleTimer()
    }
  }, [clearIdleTimer, scheduleControlsHide])

  useEffect(() => {
    window.addEventListener('keydown', showControls)
    window.addEventListener('mousemove', showControls)
    window.addEventListener('touchstart', showControls, { passive: true })

    return () => {
      window.removeEventListener('keydown', showControls)
      window.removeEventListener('mousemove', showControls)
      window.removeEventListener('touchstart', showControls)
    }
  }, [showControls])

  return { clearIdleTimer, controlsVisible, showControls }
}
