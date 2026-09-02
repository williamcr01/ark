import type { ChartJsConfig } from '../types.ts'
import { attr, descendant, directChildren, parseXml, textContent } from '../xml.ts'
import { resolveColor, type Theme } from './context.ts'

const CHART_TYPE_MAP: Record<string, ChartJsConfig['type']> = {
  barChart: 'bar',
  bar3DChart: 'bar',
  lineChart: 'line',
  line3DChart: 'line',
  pieChart: 'pie',
  pie3DChart: 'pie',
  doughnutChart: 'doughnut',
  ofPieChart: 'pie',
  radarChart: 'radar',
  scatterChart: 'scatter',
}

export function parseNumericPoint(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.toUpperCase() === '#N/A') return null
  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export function readCachePoints(container: Element | null) {
  const cache = descendant(container, 'numCache') ?? descendant(container, 'strCache')
  const literals = descendant(container, 'numLit') ?? descendant(container, 'strLit')
  const root = cache ?? literals
  if (!root) return null
  const points = [...root.getElementsByTagName('*')].filter((el) => el.localName === 'pt')
  const byIdx = new Map<number, string>()
  for (const point of points) {
    const idx = Number.parseInt(attr(point, 'idx') ?? '0', 10)
    byIdx.set(Number.isFinite(idx) ? idx : 0, textContent(descendant(point, 'v') ?? point))
  }
  const counted = Number.parseInt(attr(descendant(root, 'ptCount'), 'val') ?? '', 10)
  const length =
    Number.isFinite(counted) && counted >= 0
      ? counted
      : byIdx.size === 0
        ? 0
        : Math.max(...byIdx.keys()) + 1
  const values: string[] = []
  for (let i = 0; i < length; i++) values.push(byIdx.get(i) ?? '')
  return values
}

export function scatterPoints(xs: string[] | null, ys: string[]) {
  const count = Math.max(xs?.length ?? 0, ys.length)
  const data: Array<{ x: number; y: number }> = []
  for (let i = 0; i < count; i++) {
    const y = parseNumericPoint(ys[i] ?? '')
    if (y === null) continue
    const rawX = xs?.[i]
    const x = rawX !== undefined && rawX !== '' ? parseNumericPoint(rawX) : i
    if (x === null) continue
    data.push({ x, y })
  }
  return data
}

export function parseChartXml(xml: string, theme: Theme): ChartJsConfig | null {
  const doc = parseXml(xml)
  const plot = descendant(doc, 'plotArea')
  if (!plot) return null
  const chartEl = [...plot.children].find((child) => CHART_TYPE_MAP[child.localName])
  if (!chartEl) return null
  const type = CHART_TYPE_MAP[chartEl.localName]
  if (!type) return null

  const series = directChildren(chartEl, 'ser')
  if (series.length === 0) return null

  const firstCats = readCachePoints(descendant(series[0], 'cat'))

  const datasets: ChartJsConfig['data']['datasets'] = []
  const palette = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map(
    (key) => theme.colors[key] ?? '#4472C4',
  )

  for (const [index, ser] of series.entries()) {
    const values = readCachePoints(descendant(ser, 'val') ?? descendant(ser, 'yVal'))
    if (!values) return null
    const numbers = values.map((value) => parseNumericPoint(value))
    const label = textContent(descendant(descendant(ser, 'tx'), 'v')) || `Series ${index + 1}`
    const color = resolveColor(descendant(ser, 'spPr'), theme) ?? palette[index % palette.length]
    const data =
      type === 'scatter' ? scatterPoints(readCachePoints(descendant(ser, 'xVal')), values) : numbers
    datasets.push({
      label,
      data,
      backgroundColor:
        type === 'pie' || type === 'doughnut' ? palette.slice(0, data.length) : color,
      borderColor: color,
    })
  }

  if (datasets.length === 0) return null

  return {
    type,
    data: {
      labels:
        firstCats && firstCats.length > 0
          ? firstCats
          : datasets[0]!.data.map((_, index) => String(index + 1)),
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { labels: { color: theme.colors.dk1 ?? '#111827' } } },
    },
  }
}
