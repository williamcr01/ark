import { useEffect, useRef, useState } from 'react'

import type { ElementSize } from '@/lib/deck/deck-preview'

export function useElementSize<T extends HTMLElement>() {
  const elementRef = useRef<T>(null)
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })

  useEffect(() => {
    const element = elementRef.current

    if (!element) {
      return
    }

    const updateSize = () => {
      const { width, height } = element.getBoundingClientRect()

      setSize((current) => {
        if (Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5) {
          return current
        }

        return { width, height }
      })
    }

    updateSize()

    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(element)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  return [elementRef, size] as const
}
