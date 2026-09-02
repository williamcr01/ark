import { useLayoutEffect, useRef, useState } from 'react'

export function ModelSelectorTriggerLabel({
  modelName,
  effortLabel,
}: {
  modelName: string
  effortLabel?: string
}) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [hideEffort, setHideEffort] = useState(false)
  const fullLabel = effortLabel ? `${modelName} · ${effortLabel}` : modelName

  useLayoutEffect(() => {
    const container = containerRef.current
    const measure = measureRef.current
    if (!container || !measure || !effortLabel) {
      setHideEffort(false)
      return
    }

    const update = () => {
      const available = container.clientWidth
      if (available <= 0) {
        setHideEffort(false)
        return
      }
      setHideEffort(measure.scrollWidth > available)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [effortLabel, modelName])

  return (
    <span className="relative min-w-0 shrink overflow-hidden text-left" ref={containerRef}>
      <span aria-hidden className="invisible absolute whitespace-nowrap" ref={measureRef}>
        {fullLabel}
      </span>
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate">{modelName}</span>
        {effortLabel && !hideEffort ? <span className="shrink-0">· {effortLabel}</span> : null}
      </span>
    </span>
  )
}
