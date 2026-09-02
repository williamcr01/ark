/**
 * Extracts the editable scene behind a deck, one slide at a time.
 *
 * Reuses the same hidden render window as thumbnails and PDF export, so the walk
 * reads the deck exactly as the preview drew it - after layout, after the deck's
 * own scripts, with animation already disabled by the render host. That is what
 * lets a scene be measured rather than inferred: a slide centred with flex, grid,
 * or absolute positioning all arrive as the same rectangles.
 */

import { parseDeckHtml } from '@ark/deck-node/document/parser.ts'
import {
  applyScenePixels,
  buildDeckSceneExtractorScript,
  collectScenePixelRequests,
  DECK_SCENE_EXTRACTOR_GLOBAL,
  finalizeSceneSlide,
  SCENE_FILL_CAPTURE_ATTR,
  SCENE_FRAME_HEIGHT,
  SCENE_FRAME_WIDTH,
  type DeckScene,
  type ScenePixelRequest,
  type SceneSlide,
} from '@ark/deck-export'
import type { BrowserWindow, NativeImage } from 'electron'

import { withDeckRenderWindow, type DeckRenderWindowConfig } from './deck-render-window.ts'
import { DECK_EXPORT_MAX_SLIDES, DECK_EXPORT_TIMEOUT_MS } from './deck-export.ts'

const DECK_SCENE_LABEL = 'Deck exporter'

/** Hide descendants of a gradient fill so the crop is the fill, not the children. */
const SCENE_FILL_CAPTURE_CSS = `[${SCENE_FILL_CAPTURE_ATTR}]{color:transparent!important}[${SCENE_FILL_CAPTURE_ATTR}] *{visibility:hidden!important}`

async function waitForPaint(window: BrowserWindow) {
  await window.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    true,
  )
}

async function captureSlide(window: BrowserWindow) {
  return (await window.webContents.capturePage()).resize({
    width: SCENE_FRAME_WIDTH,
    height: SCENE_FRAME_HEIGHT,
  })
}

function cropRequests(
  capture: NativeImage,
  requests: ScenePixelRequest[],
  pixels: Map<number, string>,
) {
  for (const request of requests) {
    const { x, y, width, height } = request.rect
    if (width <= 0 || height <= 0) continue

    try {
      pixels.set(request.nodeIndex, capture.crop({ x, y, width, height }).toDataURL())
    } catch {
      // A crop that fails leaves the node without pixels; the emitter falls back
      // rather than placing an empty picture.
    }
  }
}

/**
 * Fill the regions the walk could not express with real pixels.
 *
 * Raster regions flatten the whole subtree, so they crop from a full capture.
 * Gradient fills keep their children as editable nodes, so those descendants
 * are hidden while the fill is cropped.
 */
async function attachScenePixels(window: BrowserWindow, slide: SceneSlide) {
  const requests = collectScenePixelRequests(slide)
  if (requests.length === 0) return slide

  const gradient = requests.filter((request) => request.reason === 'gradient')
  const raster = requests.filter((request) => request.reason !== 'gradient')
  const pixels = new Map<number, string>()

  if (gradient.length > 0) {
    const cssKey = await window.webContents.insertCSS(SCENE_FILL_CAPTURE_CSS)
    try {
      await waitForPaint(window)
      cropRequests(await captureSlide(window), gradient, pixels)
    } finally {
      await window.webContents.removeInsertedCSS(cssKey)
      if (raster.length > 0) await waitForPaint(window)
    }
  }

  if (raster.length > 0) {
    cropRequests(await captureSlide(window), raster, pixels)
  }

  return applyScenePixels(slide, pixels)
}

export type ExtractDeckSceneRequest = {
  html: string
  signal?: AbortSignal
}

export async function extractDeckScene(
  config: DeckRenderWindowConfig,
  request: ExtractDeckSceneRequest,
): Promise<DeckScene> {
  const parsed = parseDeckHtml(request.html)
  const extractorScript = buildDeckSceneExtractorScript()

  const slides = await withDeckRenderWindow(
    config,
    { html: request.html, slideCount: parsed.slideCount, signal: request.signal },
    {
      label: DECK_SCENE_LABEL,
      maxSlides: DECK_EXPORT_MAX_SLIDES,
      timeoutMs: DECK_EXPORT_TIMEOUT_MS,
      offscreen: true,
    },
    async ({ window, slideIndexes, gotoSlide }) => {
      // Install once; a long deck should not re-parse the walk per slide.
      await window.webContents.executeJavaScript(extractorScript, true)

      const extracted: SceneSlide[] = []
      for (const index of slideIndexes) {
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- sequential by design: each slide must be navigated to and settled before it can be measured (ordered side effects)
        await gotoSlide(index)
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- sequential by design: one extraction per settled slide, in slide order
        const slide = (await window.webContents.executeJavaScript(
          `window.${DECK_SCENE_EXTRACTOR_GLOBAL}(${index})`,
          true,
        )) as SceneSlide

        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- sequential by design: the capture must happen while this slide is the one on screen
        const withPixels = await attachScenePixels(window, slide)
        extracted.push(
          finalizeSceneSlide(withPixels, { notes: parsed.slides[index]?.notes ?? null }),
        )
      }

      return extracted
    },
  )

  return { width: SCENE_FRAME_WIDTH, height: SCENE_FRAME_HEIGHT, slides }
}

/**
 * Smoke-test assertion for an extracted scene: the walk found the right number
 * of slides, and it recovered real text rather than an opaque rectangle. Text is
 * the check that matters - a scene of shapes alone would mean the walk descended
 * but never recognised any prose.
 */
export function inspectExtractedScene(scene: DeckScene, expectedSlides = 2) {
  const fail = (detail: string) => ({ ok: false as const, detail })

  if (scene.slides.length !== expectedSlides) {
    return fail(`Scene has ${scene.slides.length} slides, expected ${expectedSlides}.`)
  }

  for (const slide of scene.slides) {
    const failure = slide.warnings.find((warning) => warning.code === 'extract-failed')
    if (failure) return fail(failure.message)

    const text = slide.nodes
      .filter((node) => node.kind === 'text')
      .flatMap((node) => (node.kind === 'text' ? node.paragraphs : []))
      .flatMap((paragraph) => paragraph.runs)

    if (text.length === 0) return fail(`Scene slide ${slide.index} recovered no text runs.`)

    // A line count of zero would let a single-line label wrap in PowerPoint.
    const miscounted = slide.nodes.find(
      (node) => node.kind === 'text' && !(Number.isInteger(node.lineCount) && node.lineCount >= 1),
    )
    if (miscounted) return fail(`Scene slide ${slide.index} has a text node with no line count.`)

    const unresolved = text.find((run) => run.fontFace.includes(','))
    if (unresolved) {
      return fail(`Scene run kept an unresolved font stack: ${unresolved.fontFace}.`)
    }
  }

  return { ok: true as const, detail: '' }
}
