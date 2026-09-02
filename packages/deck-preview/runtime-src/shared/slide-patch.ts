import { isRecord } from './values.ts'
import { findSlides } from './slides.ts'

export function parseSlideHtml(html: string) {
  // <template> parses without running scripts or losing <section> context.
  var template = document.createElement('template')
  template.innerHTML = html
  return template.content.firstElementChild
}

export function applySlidePatch(operations: unknown[]) {
  var list = findSlides()

  if (!list.length) {
    return null
  }

  var parent = list[0]!.parentNode

  if (!parent) {
    return null
  }

  for (var i = 0; i < list.length; i++) {
    if (list[i]!.parentNode !== parent) {
      return null
    }
  }

  // Stable anchor for appends: never a slide, so removals cannot detach it.
  var tail = list[list.length - 1]!.nextSibling

  for (var o = 0; o < operations.length; o++) {
    var operation = operations[o]

    if (!isRecord(operation) || typeof operation.index !== 'number') {
      return null
    }

    if (operation.op === 'remove') {
      var removed = list[operation.index]

      if (!removed) {
        return null
      }

      parent.removeChild(removed)
      list.splice(operation.index, 1)
      continue
    }

    if (operation.op !== 'insert' || typeof operation.html !== 'string') {
      return null
    }

    var inserted = parseSlideHtml(operation.html)

    if (!inserted || operation.index > list.length) {
      return null
    }

    parent.insertBefore(inserted, operation.index < list.length ? list[operation.index]! : tail)
    list.splice(operation.index, 0, inserted as HTMLElement)
  }

  return findSlides().length
}
