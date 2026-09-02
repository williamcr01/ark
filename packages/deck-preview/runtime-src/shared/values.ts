export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function clampIndex(index: number, count: number) {
  if (!Number.isFinite(index) || count <= 0) {
    return 0
  }

  return Math.max(0, Math.min(count - 1, Math.floor(index)))
}
