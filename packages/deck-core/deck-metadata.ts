/** Stable slide id attribute (see issue #74). */
export const ARK_SLIDE_ID_ATTR = 'data-ark-slide-id' as const

/** Stable editable element id attribute (issue #74). */
export const ARK_ELEMENT_ID_ATTR = 'data-ark-id' as const

/** Marks an element as Ark-managed and editable in the manual editor. */
export const ARK_EDITABLE_ATTR = 'data-ark-editable' as const

/** Semantic role for editable elements (title, body, caption, etc.). */
export const ARK_ROLE_ATTR = 'data-ark-role' as const

/** When present, the element is selectable but not editable or movable. */
export const ARK_LOCKED_ATTR = 'data-ark-locked' as const

/** Marks Ark-owned layout (safe to move/resize in the manual editor). */
export const ARK_MANAGED_ATTR = 'data-ark-managed' as const

export const TRANSIENT_SLIDE_ID_PREFIX = 'transient-slide-' as const
export const TRANSIENT_ELEMENT_ID_PREFIX = 'transient-el-' as const
/** Prefix for durable `data-ark-id` values stamped by the element patch path. */
export const STABLE_ELEMENT_ID_PREFIX = 'ark-el-' as const

/** Canonical slide size for converting normalized editor geometry to inline CSS. */
export const ARK_SLIDE_REFERENCE_WIDTH = 1280 as const
export const ARK_SLIDE_REFERENCE_HEIGHT = 720 as const
