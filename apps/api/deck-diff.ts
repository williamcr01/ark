import {
  normalizeDeckVersionDiff,
  truncateDeckVersionSlideTitle,
  type DeckVersionDiff,
} from '@ark/contracts'

import { parseDeckHtml, type ParsedDeckSlide } from './deck-parser.ts'

function coarseDiff(beforeHtml: string, afterHtml: string): DeckVersionDiff {
  return (
    normalizeDeckVersionDiff({
      kind: 'coarse',
      htmlBytesBefore: Buffer.byteLength(beforeHtml, 'utf8'),
      htmlBytesAfter: Buffer.byteLength(afterHtml, 'utf8'),
    }) ?? {
      kind: 'coarse',
      htmlBytesBefore: Buffer.byteLength(beforeHtml, 'utf8'),
      htmlBytesAfter: Buffer.byteLength(afterHtml, 'utf8'),
    }
  )
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
  const beforeByKey = new Map<string, ParsedDeckSlide[]>()
  const afterByKey = new Map<string, ParsedDeckSlide[]>()

  for (const slide of beforeSlides) {
    const key = slideMatchKey(slide)
    const bucket = beforeByKey.get(key) ?? []
    bucket.push(slide)
    beforeByKey.set(key, bucket)
  }

  for (const slide of afterSlides) {
    const key = slideMatchKey(slide)
    const bucket = afterByKey.get(key) ?? []
    bucket.push(slide)
    afterByKey.set(key, bucket)
  }

  const matched: MatchedSlidePair[] = []
  const matchedBefore = new Set<ParsedDeckSlide>()
  const matchedAfter = new Set<ParsedDeckSlide>()

  for (const [key, beforeBucket] of beforeByKey) {
    const afterBucket = afterByKey.get(key)

    if (!afterBucket) {
      continue
    }

    const pairCount = Math.min(beforeBucket.length, afterBucket.length)

    for (let index = 0; index < pairCount; index += 1) {
      const beforeSlide = beforeBucket[index]
      const afterSlide = afterBucket[index]
      matched.push({ before: beforeSlide, after: afterSlide })
      matchedBefore.add(beforeSlide)
      matchedAfter.add(afterSlide)
    }
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

function slideRef(slide: ParsedDeckSlide) {
  return {
    index: slide.index,
    title: truncateDeckVersionSlideTitle(slide.title),
  }
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
          title: truncateDeckVersionSlideTitle(afterSlide.title),
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

    return (
      normalizeDeckVersionDiff({
        kind: 'structural',
        slideCountBefore: before.slideCount,
        slideCountAfter: after.slideCount,
        addedSlides: added.map(slideRef),
        deletedSlides: deleted.map(slideRef),
        movedSlides,
        changedSlides,
        titleChanged: before.title !== after.title ? true : undefined,
        assetsAdded: assetsAdded.length > 0 ? assetsAdded : undefined,
        assetsRemoved: assetsRemoved.length > 0 ? assetsRemoved : undefined,
      }) ?? coarseDiff(beforeHtml, afterHtml)
    )
  } catch {
    return coarseDiff(beforeHtml, afterHtml)
  }
}
