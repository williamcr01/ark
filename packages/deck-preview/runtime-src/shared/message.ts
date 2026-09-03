import './constants.ts'
import { isRecord } from './values.ts'

export function readGotoIndex(data: unknown) {
  if (isRecord(data) && data.type === C.GOTO && typeof data.index === 'number') {
    return data.index
  }

  return null
}

export function readSlidePatchCommand(data: unknown) {
  if (!isRecord(data) || data.type !== C.PATCH || !Array.isArray(data.operations)) {
    return null
  }

  return {
    operations: data.operations as unknown[],
    patchId: data.patchId,
    index: typeof data.index === 'number' ? data.index : undefined,
  }
}

export function isParentWindowMessage(event: MessageEvent) {
  if (event.source !== window.parent) {
    return false
  }

  if (C.PARENT_ORIGIN && event.origin !== C.PARENT_ORIGIN) {
    return false
  }

  return true
}
