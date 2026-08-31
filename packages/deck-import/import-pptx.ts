import { parsePptxArchive } from './parse-ooxml.ts'
import { emitImportedHtml } from './emit-html.ts'

export type ImportPptxOptions = {
  filename?: string | null
}

export type ImportedPptxDeck = {
  html: string
  title: string
  slideCount: number
  warnings: string[]
}

export function importPptxToHtml(
  bytes: Uint8Array,
  options: ImportPptxOptions = {},
): Promise<ImportedPptxDeck> {
  return parsePptxArchive(bytes, options.filename).then((presentation) => {
    const html = emitImportedHtml(presentation)
    const warnings: string[] = []
    for (const slide of presentation.slides) {
      if (slide.objects.some((object) => object.kind === 'unmappable')) {
        warnings.push(`Slide ${slide.index + 1} has decoration that was flattened to a picture.`)
      }
      if (slide.objects.some((object) => object.kind === 'chart' && object.config === null)) {
        warnings.push(
          `Slide ${slide.index + 1} has a chart that could not be recovered as Chart.js.`,
        )
      }
    }
    return {
      html,
      title: presentation.title,
      slideCount: presentation.slides.length,
      warnings,
    }
  })
}
