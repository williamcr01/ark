/**
 * A rectangle expressed as fractions of its slide, so it survives preview scaling.
 * The editor protocol re-exports this as `EditorNormalizedRect`.
 */
export type NormalizedRect = {
  x: number
  y: number
  width: number
  height: number
}
