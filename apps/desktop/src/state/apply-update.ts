export type StateUpdate<T> = T | ((current: T) => T)

export function resolveUpdate<T>(current: T, update: StateUpdate<T>): T {
  return typeof update === 'function' ? (update as (current: T) => T)(current) : update
}
