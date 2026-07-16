import type {
  EditorNormalizedRect,
  EditorTransformCommitMessage,
} from '@ark/deck-core/deck-editor-bridge.ts'
import { buildTextBoxHtml } from '@ark/deck-core/deck-text-box.ts'
import type { DeckElementPatchOperation } from '@ark/deck-core/deck-patch.ts'

const TRANSFORM_EPSILON = 0.0005

function geometryChanged(
  before: EditorNormalizedRect,
  after: EditorNormalizedRect,
  keys: Array<keyof EditorNormalizedRect>,
) {
  return keys.some((key) => Math.abs(before[key] - after[key]) > TRANSFORM_EPSILON)
}

export function buildTransformPatchOperations(
  commit: EditorTransformCommitMessage,
  previousGeometry: EditorNormalizedRect | null,
  slideId: string | null,
): DeckElementPatchOperation[] {
  const operations: DeckElementPatchOperation[] = []
  const target = {
    elementId: commit.elementId,
    slideIndex: commit.slideIndex,
    ...(slideId ? { slideId } : {}),
  }

  if (
    commit.adopted ||
    !previousGeometry ||
    geometryChanged(previousGeometry, commit.geometry, ['x', 'y'])
  ) {
    operations.push({
      op: 'move_element',
      ...target,
      x: commit.geometry.x,
      y: commit.geometry.y,
      ...(commit.cssX !== undefined ? { cssX: commit.cssX } : {}),
      ...(commit.cssY !== undefined ? { cssY: commit.cssY } : {}),
      ...(commit.slideWidth !== undefined ? { slideWidth: commit.slideWidth } : {}),
      ...(commit.slideHeight !== undefined ? { slideHeight: commit.slideHeight } : {}),
      ...(commit.adopted ? { width: commit.geometry.width } : {}),
      ...(commit.adopted && commit.cssWidth !== undefined ? { cssWidth: commit.cssWidth } : {}),
    })
  }

  if (
    !commit.adopted &&
    (!previousGeometry || geometryChanged(previousGeometry, commit.geometry, ['width', 'height']))
  ) {
    operations.push({
      op: 'resize_element',
      ...target,
      width: commit.geometry.width,
      height: commit.geometry.height,
      ...(commit.cssWidth !== undefined ? { cssWidth: commit.cssWidth } : {}),
      ...(commit.cssHeight !== undefined ? { cssHeight: commit.cssHeight } : {}),
      ...(commit.slideWidth !== undefined ? { slideWidth: commit.slideWidth } : {}),
      ...(commit.slideHeight !== undefined ? { slideHeight: commit.slideHeight } : {}),
    })
  }

  return operations
}

export function buildTextBoxInsertOperation(
  slideIndex: number,
  geometry: EditorNormalizedRect,
  slideId: string | null,
): DeckElementPatchOperation {
  return {
    op: 'insert_element',
    slideIndex,
    ...(slideId ? { slideId } : {}),
    html: buildTextBoxHtml(geometry),
  }
}
