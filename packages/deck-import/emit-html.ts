import {
  ARK_EDITABLE_ATTR,
  ARK_ELEMENT_ID_ATTR,
  ARK_LOCKED_ATTR,
  ARK_MANAGED_ATTR,
  ARK_SLIDE_ID_ATTR,
} from '@ark/deck/document/metadata.ts'
import {
  ARK_TEXT_BOX_CLASS as TEXT_BOX_CLASS,
  ARK_TEXT_BOX_EDITABLE_VALUE as TEXT_BOX_EDITABLE,
} from '@ark/deck/patch/text-box.ts'
import {
  buildDeckFontRootCss,
  DECK_FONT_MARKER_ATTRS,
  DEFAULT_DECK_FONT_IDS,
  getDeckFont,
} from '@ark/runtime-registry/deck-font-registry.ts'

import type {
  ChartJsConfig,
  ImportedObject,
  ImportedPresentation,
  ImportedSlide,
  ImportedTextRun,
  MediaBlob,
  PxRect,
} from './types.ts'

const CHART_RUNTIME_SRC = '/api/runtimes/chart.js/4.5.1/chart.umd.min.js'

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function escapeStyle(value: string) {
  return value.replaceAll(';', '\\3b ').replaceAll('"', '\\22 ')
}

function px(value: number) {
  return `${Math.round(value)}px`
}

function bytesToDataUrl(media: MediaBlob) {
  return `data:${media.mediaType};base64,${Buffer.from(media.bytes).toString('base64')}`
}

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}

function plateFontFamily() {
  return getDeckFont(DEFAULT_DECK_FONT_IDS.body)?.cssStack ?? 'sans-serif'
}

function rectStyle(rect: PxRect, extra: string[] = []) {
  const parts = [
    'position:absolute',
    `left:${px(rect.x)}`,
    `top:${px(rect.y)}`,
    `width:${px(Math.max(1, rect.width))}`,
    `height:${px(Math.max(1, rect.height))}`,
    'box-sizing:border-box',
  ]
  if (rect.rotation) {
    parts.push(`transform:rotate(${rect.rotation}deg)`, 'transform-origin:center center')
  }
  parts.push(...extra)
  return parts.join(';')
}

function elementId(slideIndex: number, objectIndex: number) {
  return `ark-el-import-${slideIndex + 1}-${objectIndex + 1}`
}

function slideId(slideIndex: number) {
  return `ark-slide-import-${slideIndex + 1}`
}

function isMappable(object: ImportedObject) {
  return object.kind !== 'unmappable'
}

function renderRun(run: ImportedTextRun) {
  let html = escapeHtml(run.text).replaceAll('\n', '<br>')
  if (run.bold) html = `<strong>${html}</strong>`
  if (run.italic) html = `<em>${html}</em>`
  if (run.underline) html = `<u>${html}</u>`
  const styles: string[] = []
  if (run.fontSizePx) styles.push(`font-size:${px(run.fontSizePx)}`)
  if (run.color) styles.push(`color:${escapeStyle(run.color)}`)
  if (run.fontStack) styles.push(`font-family:${escapeStyle(run.fontStack)}`)
  if (styles.length === 0) return html
  return `<span style="${styles.join(';')}">${html}</span>`
}

function svgForPlate(slide: ImportedSlide, objects: ImportedObject[]) {
  const nodes: string[] = [
    `<rect width="1280" height="720" fill="${escapeHtml(slide.backgroundColor)}"/>`,
  ]
  if (slide.backgroundImage) {
    nodes.push(
      `<image href="${bytesToDataUrl(slide.backgroundImage)}" x="0" y="0" width="1280" height="720" preserveAspectRatio="xMidYMid slice"/>`,
    )
  }
  for (const object of objects) {
    const { x, y, width, height } = object.rect
    if (object.kind === 'image' || (object.kind === 'unmappable' && object.media)) {
      const media = object.kind === 'image' ? object.media : object.media
      if (media) {
        nodes.push(
          `<image href="${bytesToDataUrl(media)}" x="${x}" y="${y}" width="${Math.max(1, width)}" height="${Math.max(1, height)}" preserveAspectRatio="xMidYMid meet"/>`,
        )
      }
      continue
    }
    if (object.kind === 'text') {
      const text = object.paragraphs.map((p) => p.runs.map((run) => run.text).join('')).join(' ')
      nodes.push(
        `<text x="${x + 8}" y="${y + Math.max(18, height / 2)}" fill="${escapeHtml(object.color ?? '#111827')}" font-size="24" font-family="${escapeHtml(plateFontFamily())}">${escapeHtml(text)}</text>`,
      )
      continue
    }
    const fill =
      object.kind === 'shape' ? object.fill : object.kind === 'unmappable' ? object.fill : '#CBD5E1'
    nodes.push(
      `<rect x="${x}" y="${y}" width="${Math.max(1, width)}" height="${Math.max(1, height)}" fill="${escapeHtml(fill ?? '#CBD5E1')}"/>`,
    )
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">${nodes.join('')}</svg>`
}

function rasterChartSvg(object: Extract<ImportedObject, { kind: 'chart' }>) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, object.rect.width)}" height="${Math.max(1, object.rect.height)}" viewBox="0 0 ${Math.max(1, object.rect.width)} ${Math.max(1, object.rect.height)}"><rect width="100%" height="100%" fill="#E2E8F0"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#475569" font-size="20" font-family="${escapeHtml(plateFontFamily())}">Chart</text></svg>`
}

function emitNotes(notes: string | null) {
  if (!notes?.trim()) return ''
  return `\n    <aside class="notes">${escapeHtml(notes.trim())}</aside>`
}

function emitText(object: Extract<ImportedObject, { kind: 'text' }>, id: string) {
  const justify =
    object.valign === 'middle' ? 'center' : object.valign === 'bottom' ? 'flex-end' : 'flex-start'
  const paragraphs = object.paragraphs
    .map((paragraph) => {
      const inner = paragraph.runs.map(renderRun).join('') || '&nbsp;'
      return `<p style="margin:0;text-align:${paragraph.align}">${inner}</p>`
    })
    .join('')
  const extra = [
    'display:flex',
    'flex-direction:column',
    `justify-content:${justify}`,
    'overflow:hidden',
    object.fill ? `background:${escapeStyle(object.fill)}` : '',
    object.color ? `color:${escapeStyle(object.color)}` : '',
    object.fontStack
      ? `font-family:${escapeStyle(object.fontStack)}`
      : 'font-family:var(--ark-font-body)',
    'z-index:2',
  ].filter(Boolean)
  return `<div class="${TEXT_BOX_CLASS}" ${ARK_EDITABLE_ATTR}="${TEXT_BOX_EDITABLE}" ${ARK_MANAGED_ATTR}="true" ${ARK_ELEMENT_ID_ATTR}="${id}" style="${rectStyle(object.rect, extra)}">${paragraphs}</div>`
}

function emitShape(object: Extract<ImportedObject, { kind: 'shape' }>, id: string) {
  const extra = [
    object.fill ? `background:${escapeStyle(object.fill)}` : 'background:transparent',
    object.stroke ? `border:2px solid ${escapeStyle(object.stroke)}` : '',
    object.shape === 'ellipse' ? 'border-radius:50%' : '',
    object.shape === 'roundRect' ? 'border-radius:16px' : '',
    'z-index:1',
  ].filter(Boolean)
  return `<div ${ARK_MANAGED_ATTR}="true" ${ARK_EDITABLE_ATTR}="true" ${ARK_ELEMENT_ID_ATTR}="${id}" data-ark-shape="${object.shape}" style="${rectStyle(object.rect, extra)}"></div>`
}

function emitImage(object: Extract<ImportedObject, { kind: 'image' }>, id: string) {
  return `<img ${ARK_MANAGED_ATTR}="true" ${ARK_EDITABLE_ATTR}="image" ${ARK_ELEMENT_ID_ATTR}="${id}" alt="${escapeHtml(object.alt)}" src="${bytesToDataUrl(object.media)}" style="${rectStyle(object.rect, ['object-fit:contain', 'z-index:2'])}" />`
}

function emitChart(
  object: Extract<ImportedObject, { kind: 'chart' }>,
  id: string,
  canvasId: string,
) {
  if (!object.config) {
    return `<img ${ARK_MANAGED_ATTR}="true" ${ARK_EDITABLE_ATTR}="image" ${ARK_ELEMENT_ID_ATTR}="${id}" alt="Chart" src="${svgDataUrl(rasterChartSvg(object))}" style="${rectStyle(object.rect, ['object-fit:contain', 'z-index:2'])}" />`
  }
  return `<div ${ARK_MANAGED_ATTR}="true" ${ARK_ELEMENT_ID_ATTR}="${id}" class="ark-imported-chart" style="${rectStyle(object.rect, ['z-index:2'])}"><canvas id="${canvasId}" role="img" aria-label="Imported chart"></canvas></div>`
}

function emitPlate(src: string) {
  return `<img class="ark-import-plate" ${ARK_LOCKED_ATTR}="true" alt="" src="${src}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0" />`
}

function slideTitle(slide: ImportedSlide) {
  for (const object of slide.objects) {
    if (object.kind !== 'text') continue
    const text = object.paragraphs
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
      .join(' ')
      .trim()
    if (text) return text
  }
  return `Slide ${slide.index + 1}`
}

function emitSlide(slide: ImportedSlide, charts: Array<{ id: string; config: ChartJsConfig }>) {
  const mappable = slide.objects.filter(isMappable)
  const unmappable = slide.objects.filter((object) => !isMappable(object))
  const rasterWholeSlide = mappable.length === 0
  const parts: string[] = []
  parts.push(`    <!-- slide: ${escapeHtml(slideTitle(slide))} -->`)
  parts.push(
    `    <section class="slide" ${ARK_SLIDE_ID_ATTR}="${slideId(slide.index)}" style="background:${escapeStyle(slide.backgroundColor)}">`,
  )
  parts.push(`      <span class="ark-sr-only">${escapeHtml(slideTitle(slide))}</span>`)

  if (rasterWholeSlide) {
    parts.push(`      ${emitPlate(svgDataUrl(svgForPlate(slide, slide.objects)))}`)
  } else {
    if (slide.backgroundImage || unmappable.length > 0) {
      const plateObjects: ImportedObject[] = []
      if (slide.backgroundImage) {
        plateObjects.push({
          kind: 'image',
          rect: { x: 0, y: 0, width: 1280, height: 720 },
          media: slide.backgroundImage,
          alt: '',
        })
      }
      plateObjects.push(...unmappable)
      parts.push(
        `      ${emitPlate(svgDataUrl(svgForPlate({ ...slide, backgroundImage: null }, plateObjects)))}`,
      )
    }
    let objectIndex = 0
    for (const object of mappable) {
      const id = elementId(slide.index, objectIndex)
      objectIndex += 1
      if (object.kind === 'text') parts.push(`      ${emitText(object, id)}`)
      else if (object.kind === 'shape') parts.push(`      ${emitShape(object, id)}`)
      else if (object.kind === 'image') parts.push(`      ${emitImage(object, id)}`)
      else if (object.kind === 'chart') {
        const canvasId = `ark-import-chart-${slide.index}-${objectIndex}`
        if (object.config) charts.push({ id: canvasId, config: object.config })
        parts.push(`      ${emitChart(object, id, canvasId)}`)
      }
    }
  }

  parts.push(`      ${emitNotes(slide.notes)}`)
  parts.push('    </section>')
  return parts.join('\n')
}

function emitChartScript(charts: Array<{ id: string; config: ChartJsConfig }>) {
  if (charts.length === 0) return ''
  const payload = JSON.stringify(charts).replaceAll('<', '\\u003c')
  return `
    <script src="${CHART_RUNTIME_SRC}"></script>
    <script>
      ;(function () {
        var items = ${payload};
        var slides = Array.prototype.slice.call(document.querySelectorAll('section.slide'));
        var index = 0;
        function setSlide(nextIndex) {
          index = Math.max(0, Math.min(slides.length - 1, nextIndex));
          slides.forEach(function (slide, i) {
            var active = i === index;
            slide.classList.toggle('active', active);
            slide.setAttribute('aria-hidden', String(!active));
          });
          document.dispatchEvent(new CustomEvent('ark:deck-slide-change', { detail: { index: index } }));
        }
        document.addEventListener('ark:deck-goto', function (event) {
          setSlide(event.detail.index);
        });
        var NAV_KEYS = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
        function isTypingTarget(target) {
          return Boolean(target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]'));
        }
        function handleNavKey(event) {
          if (isTypingTarget(event.target)) return;
          var delta = NAV_KEYS[event.key];
          if (!delta) return;
          event.preventDefault();
          event.stopPropagation();
          setSlide(index + delta);
        }
        document.addEventListener('keydown', handleNavKey, true);
        window.addEventListener('keydown', handleNavKey, true);
        function boot() {
          if (typeof Chart === 'undefined') return;
          items.forEach(function (item) {
            var canvas = document.getElementById(item.id);
            if (!canvas) return;
            new Chart(canvas, item.config);
          });
        }
        setSlide(0);
        boot();
      })();
    </script>`
}

export function emitImportedHtml(presentation: ImportedPresentation) {
  const charts: Array<{ id: string; config: ChartJsConfig }> = []
  const slides = presentation.slides.map((slide) => emitSlide(slide, charts)).join('\n')
  const hasCharts = charts.length > 0
  const displayId = getDeckFont(presentation.displayFontId)?.id ?? DEFAULT_DECK_FONT_IDS.display
  const bodyId = getDeckFont(presentation.bodyFontId)?.id ?? DEFAULT_DECK_FONT_IDS.body
  const fontCss = buildDeckFontRootCss({
    display: displayId,
    body: bodyId,
    mono: DEFAULT_DECK_FONT_IDS.mono,
  })
  const htmlAttrs = [
    'lang="en"',
    `${DECK_FONT_MARKER_ATTRS.display}="${displayId}"`,
    `${DECK_FONT_MARKER_ATTRS.body}="${bodyId}"`,
    `${DECK_FONT_MARKER_ATTRS.mono}="${DEFAULT_DECK_FONT_IDS.mono}"`,
  ]
  if (hasCharts) {
    htmlAttrs.push(
      'data-ark-deck="nav"',
      'data-ark-preview="full-js"',
      'data-ark-runtime="chart"',
      'data-ark-runtime-lib="chart.js"',
      'data-ark-runtime-version="4.5.1"',
    )
  }

  return `<!DOCTYPE html>
<html ${htmlAttrs.join(' ')}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(presentation.title)}</title>
    <style>
${fontCss}
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: #0f172a;
        color: #111827;
        font-family: var(--ark-font-body);
      }
      section.slide {
        position: relative;
        display: none;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
        box-sizing: border-box;
        margin: 0;
      }
      section.slide.active,
      section.slide.is-active {
        display: block;
      }
      .ark-text-box p { margin: 0; }
      .ark-sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .ark-imported-chart, .ark-imported-chart canvas {
        width: 100%;
        height: 100%;
      }
      aside.notes { display: none; }
    </style>
  </head>
  <body>
${slides}
${emitChartScript(charts)}
  </body>
</html>
`
}

export { TEXT_BOX_CLASS, TEXT_BOX_EDITABLE, ARK_MANAGED_ATTR }
