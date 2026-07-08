import type { DeckVersionDiff } from '@ark/contracts'

import { parseDeckHtml, type ParsedDeckSlide } from './deck-parser.ts'

function coarseDiff(beforeHtml: string, afterHtml: string): DeckVersionDiff {
  return {
    kind: 'coarse',
    htmlBytesBefore: Buffer.byteLength(beforeHtml, 'utf8'),
    htmlBytesAfter: Buffer.byteLength(afterHtml, 'utf8'),
  }
}

function slideMatchKey(slide: ParsedDeckSlide) {
  if (slide.slideId && !slide.slideIdTransient) {
    return `id:${slide.slideId}`
  }

  return `fallback:${slide.index}:${slide.title}`
}

type MatchedSlidePair = {
  before: ParsedDeckSlide
  after: ParsedDeckSlide
}

function matchSlides(beforeSlides: ParsedDeckSlide[], afterSlides: ParsedDeckSlide[]) {
  const beforeByKey = new Map<string, ParsedDeckSlide>()
  const afterByKey = new Map<string, ParsedDeckSlide>()

  for (const slide of beforeSlides) {
    beforeByKey.set(slideMatchKey(slide), slide)
  }

  for (const slide of afterSlides) {
    afterByKey.set(slideMatchKey(slide), slide)
  }

  const matched: MatchedSlidePair[] = []
  const matchedBefore = new Set<ParsedDeckSlide>()
  const matchedAfter = new Set<ParsedDeckSlide>()

  for (const [key, beforeSlide] of beforeByKey) {
    const afterSlide = afterByKey.get(key)

    if (!afterSlide) {
      continue
    }

    matched.push({ before: beforeSlide, after: afterSlide })
    matchedBefore.add(beforeSlide)
    matchedAfter.add(afterSlide)
  }

  const unmatchedBefore = beforeSlides.filter((slide) => !matchedBefore.has(slide))
  const unmatchedAfter = afterSlides.filter((slide) => !matchedAfter.has(slide))

  for (const beforeSlide of [...unmatchedBefore]) {
    const titleMatchIndex = unmatchedAfter.findIndex(
      (afterSlide) => afterSlide.title === beforeSlide.title,
    )

    if (titleMatchIndex < 0) {
      continue
    }

    const afterSlide = unmatchedAfter[titleMatchIndex]
    matched.push({ before: beforeSlide, after: afterSlide })
    matchedBefore.add(beforeSlide)
    matchedAfter.add(afterSlide)
    unmatchedBefore.splice(unmatchedBefore.indexOf(beforeSlide), 1)
    unmatchedAfter.splice(titleMatchIndex, 1)
  }

  return {
    matched,
    deleted: unmatchedBefore,
    added: unmatchedAfter,
  }
}

function assetUrls(assets: Array<{ url: string }>) {
  return [...new Set(assets.map((asset) => asset.url))].sort()
}

export function computeDeckVersionDiff(beforeHtml: string, afterHtml: string): DeckVersionDiff {
  if (!beforeHtml.trim() || !afterHtml.trim()) {
    return coarseDiff(beforeHtml, afterHtml)
  }

  try {
    const before = parseDeckHtml(beforeHtml)
    const after = parseDeckHtml(afterHtml)

    if (before.slideCount === 0 && after.slideCount === 0 && before.structure === 'unknown') {
      return coarseDiff(beforeHtml, afterHtml)
    }

    const { matched, deleted, added } = matchSlides(before.slides, after.slides)
    const movedSlides = matched
      .filter(
        ({ before: beforeSlide, after: afterSlide }) => beforeSlide.index !== afterSlide.index,
      )
      .map(({ before: beforeSlide, after: afterSlide }) => ({
        fromIndex: beforeSlide.index,
        toIndex: afterSlide.index,
      }))

    const changedSlides = matched
      .map(({ before: beforeSlide, after: afterSlide }) => {
        const titleChanged = beforeSlide.title !== afterSlide.title
        const notesChanged = (beforeSlide.notes ?? '') !== (afterSlide.notes ?? '')
        const contentChanged = beforeSlide.outerHTML !== afterSlide.outerHTML

        if (!titleChanged && !notesChanged && !contentChanged) {
          return null
        }

        return {
          index: afterSlide.index,
          title: afterSlide.title,
          titleChanged: titleChanged || undefined,
          notesChanged: notesChanged || undefined,
          contentChanged: contentChanged || undefined,
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

    const beforeAssets = assetUrls(before.assets)
    const afterAssets = assetUrls(after.assets)
    const assetsAdded = afterAssets.filter((url) => !beforeAssets.includes(url))
    const assetsRemoved = beforeAssets.filter((url) => !afterAssets.includes(url))

    return {
      kind: 'structural',
      slideCountBefore: before.slideCount,
      slideCountAfter: after.slideCount,
      addedSlides: added.map((slide) => ({ index: slide.index, title: slide.title })),
      deletedSlides: deleted.map((slide) => ({ index: slide.index, title: slide.title })),
      movedSlides,
      changedSlides,
      titleChanged: before.title !== after.title ? true : undefined,
      assetsAdded: assetsAdded.length > 0 ? assetsAdded : undefined,
      assetsRemoved: assetsRemoved.length > 0 ? assetsRemoved : undefined,
    }
  } catch {
    return coarseDiff(beforeHtml, afterHtml)
  }
}
