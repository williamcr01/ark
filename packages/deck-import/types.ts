export type EmuRect = {
  x: number
  y: number
  width: number
  height: number
  rotation?: number
}

export type PxRect = {
  x: number
  y: number
  width: number
  height: number
  rotation?: number
}

export type MediaBlob = {
  partPath: string
  mediaType: string
  bytes: Uint8Array
}

export type ChartJsConfig = {
  type: 'bar' | 'line' | 'pie' | 'doughnut' | 'radar' | 'scatter'
  data: {
    labels: string[]
    datasets: Array<{
      label?: string
      data: number[] | Array<{ x: number; y: number }>
      backgroundColor?: string | string[]
      borderColor?: string | string[]
    }>
  }
  options: Record<string, unknown>
}

export type ImportedTextRun = {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  fontSizePx: number | null
  color: string | null
  fontStack: string | null
}

export type ImportedParagraph = {
  align: 'left' | 'center' | 'right'
  runs: ImportedTextRun[]
}

export type ImportedObject =
  | {
      kind: 'text'
      rect: PxRect
      paragraphs: ImportedParagraph[]
      fill: string | null
      color: string | null
      fontStack: string | null
      valign: 'top' | 'middle' | 'bottom'
    }
  | {
      kind: 'shape'
      rect: PxRect
      shape: 'rect' | 'roundRect' | 'ellipse'
      fill: string | null
      stroke: string | null
    }
  | {
      kind: 'image'
      rect: PxRect
      media: MediaBlob
      alt: string
    }
  | {
      kind: 'chart'
      rect: PxRect
      config: ChartJsConfig | null
    }
  | {
      kind: 'unmappable'
      rect: PxRect
      reason: string
      fill: string | null
      media: MediaBlob | null
    }

export type ImportedSlide = {
  index: number
  notes: string | null
  backgroundColor: string
  backgroundImage: MediaBlob | null
  objects: ImportedObject[]
}

export type ImportedPresentation = {
  title: string
  slides: ImportedSlide[]
  displayFontId: string
  bodyFontId: string
}
