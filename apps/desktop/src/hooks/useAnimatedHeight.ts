import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

type AnimatedHeightOptions = {
  duration?: number
  easingProperty?: string
  fallbackEasing?: string
}

/**
 * Animates an element between its height before and after a controlled render.
 * Call the returned capture function immediately before changing the state
 * represented by `dependency`.
 */
export function useAnimatedHeight<T extends HTMLElement>(
  ref: RefObject<T | null>,
  dependency: unknown,
  {
    duration = 280,
    easingProperty = '--ark-spring-ease',
    fallbackEasing = 'cubic-bezier(0.32, 0.72, 0, 1)',
  }: AnimatedHeightOptions = {},
) {
  const fromHeightRef = useRef<number | null>(null)
  const animationRef = useRef<Animation | null>(null)

  const captureHeight = useCallback(() => {
    fromHeightRef.current = ref.current?.getBoundingClientRect().height ?? null
  }, [ref])

  useLayoutEffect(() => {
    const element = ref.current
    const fromHeight = fromHeightRef.current
    fromHeightRef.current = null
    animationRef.current?.cancel()
    animationRef.current = null

    if (!element || fromHeight === null) {
      return
    }

    const toHeight = element.getBoundingClientRect().height
    if (
      Math.abs(toHeight - fromHeight) < 1 ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      typeof element.animate !== 'function'
    ) {
      return
    }

    const easing =
      getComputedStyle(element).getPropertyValue(easingProperty).trim() || fallbackEasing
    const animation = element.animate(
      [{ height: `${fromHeight}px` }, { height: `${toHeight}px` }],
      { duration, easing },
    )
    animationRef.current = animation
    animation.onfinish = () => {
      if (animationRef.current === animation) {
        animationRef.current = null
      }
    }

    return () => animation.cancel()
  }, [dependency, duration, easingProperty, fallbackEasing, ref])

  return captureHeight
}
