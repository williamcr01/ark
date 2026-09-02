export type EditorTool = 'select' | 'text' | 'insert'

export type NormalizedRect = {
  x: number
  y: number
  width: number
  height: number
}

export type Point = {
  x: number
  y: number
}

export type RgbaColor = {
  r: number
  g: number
  b: number
  a: number
}

export type SnapGuide = {
  axis: string
  position: number
}

export type InlineSnapshot = {
  hadStyle: boolean
  style: string
}

export type PositionContext = {
  containingBlock: HTMLElement
  scaleX: number
  scaleY: number
}

export function asHtml(value: EventTarget | Node | Element | null | undefined): HTMLElement {
  return value as HTMLElement
}

export type SpacerFootprint = {
  width: number
  height: number
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
  display: string
}

export type TransformCache = {
  startGeometry?: NormalizedRect
  slideRect?: DOMRect
  slideBounds?: NormalizedRect
  blockRect?: DOMRect
  logicalSlideWidth?: number
  logicalSlideHeight?: number
  logicalWidth?: number
  zIndex?: number | null
  marginLeft?: number
  marginTop?: number
  authoredTransform?: boolean | string
  liveTransformBase?: string
  liveTransform?: boolean
  spacerFootprint?: SpacerFootprint | null
  spacerElement?: HTMLElement | null
  stampedTransientId?: string | null
  commitPayload?: Record<string, unknown>
}

export type TransformMember = {
  element: HTMLElement
  startGeometry: NormalizedRect
  snapshot: InlineSnapshot
  adopted: boolean
  logicalWidth: number
  positionContext: PositionContext
  cache: TransformCache
  lastGeometry?: NormalizedRect
}

export type PendingPointer = {
  clientX: number
  clientY: number
  altKey?: boolean
  shiftKey?: boolean
}

export type TransformState = {
  kind?: 'draw' | 'move' | 'resize'
  pointerId?: number
  handle?: string | null
  element?: HTMLElement | null
  members?: TransformMember[]
  startPoint?: Point
  startGeometry?: NormalizedRect
  snapshot?: InlineSnapshot
  adopted?: boolean
  logicalWidth?: number
  positionContext?: PositionContext
  cache?: TransformCache
  started?: boolean
  snapRects?: NormalizedRect[]
  editOnClick?: boolean
  pendingPointer?: PendingPointer | null
  rafId?: number
  lastGeometry?: NormalizedRect
}

export type NudgeState = {
  element: HTMLElement
  adopted: boolean
  geometry: NormalizedRect
  startGeometry: NormalizedRect
  snapshot: InlineSnapshot
  positionContext: PositionContext
  cache: TransformCache
  members: TransformMember[]
  timer: number | null
  layoutCorrectionScheduled?: boolean
}

export type PortCandidate = {
  port: MessagePort
  remotePort: MessagePort
  post: (message: unknown) => void
  close: () => void
  accepted: boolean
}

export type PendingHover = {
  eventTarget: EventTarget | null
}
