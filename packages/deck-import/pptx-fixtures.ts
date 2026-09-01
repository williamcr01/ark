import JSZip from 'jszip'

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
const OFFICEDOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'
const SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'
const THEME_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme'
const NOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide'
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
const CHART_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart'

export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

export const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${A}" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
      <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
      <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Calibri"/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office"/>
  </a:themeElements>
</a:theme>`

export type FixtureShape = {
  name?: string
  text?: string
  font?: string
  x?: number
  y?: number
  cx?: number
  cy?: number
  fill?: string
  noFill?: boolean
  outlineFill?: string
  outlineNoFill?: boolean
  textFill?: string
  textOutline?: string
  geom?: string
  effects?: boolean
  txBox?: boolean
  omitXfrm?: boolean
  placeholder?: string
}

export type FixtureSlide = {
  notes?: string
  shapes?: FixtureShape[]
  picture?: boolean | 'emf' | 'wmf'
  chart?: 'cached' | 'uncached' | 'scatter' | 'blank-point'
  smartArt?: boolean
}

export type BuildPptxOptions = {
  title?: string
  slides: FixtureSlide[]
}

function xfrm(x: number, y: number, cx: number, cy: number) {
  return `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
}

function runPrXml(shape: FixtureShape) {
  const font = shape.font ?? 'Calibri'
  const fill = shape.textFill ?? '111827'
  const outline = shape.textOutline
    ? `<a:ln><a:solidFill><a:srgbClr val="${shape.textOutline}"/></a:solidFill></a:ln>`
    : ''
  return `<a:rPr lang="en-US" sz="3200" b="1">${outline}<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:latin typeface="${font}"/></a:rPr>`
}

function textBodyXml(shape: FixtureShape) {
  if (!shape.text) return '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>'
  const rPr = runPrXml(shape)
  const runs = shape.text
    .split('\n')
    .map((line, index, lines) => {
      const br = index < lines.length - 1 ? '<a:br/>' : ''
      return `<a:r>${rPr}<a:t>${escapeXml(line)}</a:t></a:r>${br}`
    })
    .join('')
  return `<p:txBody><a:bodyPr/><a:lstStyle/><a:p>${runs}</a:p></p:txBody>`
}

function shapeXml(shape: FixtureShape, index: number) {
  const x = shape.x ?? 914_400
  const y = shape.y ?? 914_400
  const cx = shape.cx ?? 4_572_000
  const cy = shape.cy ?? 1_371_600
  const geom = shape.geom ?? 'rect'
  const fill = shape.fill ?? '4472C4'
  const effects = shape.effects
    ? '<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst>'
    : ''
  const fillXml = shape.noFill
    ? '<a:noFill/>'
    : `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>`
  const lnXml = shape.outlineNoFill
    ? '<a:ln><a:noFill/></a:ln>'
    : shape.outlineFill
      ? `<a:ln><a:solidFill><a:srgbClr val="${shape.outlineFill}"/></a:solidFill></a:ln>`
      : ''
  const nvPr = shape.placeholder
    ? `<p:nvPr><p:ph type="${escapeXml(shape.placeholder)}"/></p:nvPr>`
    : '<p:nvPr/>'
  const txBoxAttr = shape.txBox === false ? '' : ' txBox="1"'
  const shapeName = escapeXml(shape.name ?? `Shape ${index + 1}`)
  return `<p:sp>
    <p:nvSpPr>
      <p:cNvPr id="${index + 2}" name="${shapeName}"/>
      <p:cNvSpPr${txBoxAttr}/>
      ${nvPr}
    </p:nvSpPr>
    <p:spPr>
      ${shape.omitXfrm ? '' : xfrm(x, y, cx, cy)}
      <a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>
      ${fillXml}
      ${lnXml}
      ${effects}
    </p:spPr>
    ${textBodyXml(shape)}
  </p:sp>`
}

function pictureXml(relId: string, index: number) {
  return `<p:pic>
    <p:nvPicPr>
      <p:cNvPr id="${index + 20}" name="Picture"/>
      <p:cNvPicPr/>
      <p:nvPr/>
    </p:nvPicPr>
    <p:blipFill>
      <a:blip r:embed="${relId}"/>
      <a:stretch><a:fillRect/></a:stretch>
    </p:blipFill>
    <p:spPr>${xfrm(6_096_000, 914_400, 4_572_000, 2_743_200)}</p:spPr>
  </p:pic>`
}

function chartFrameXml(relId: string, index: number) {
  return `<p:graphicFrame>
    <p:nvGraphicFramePr>
      <p:cNvPr id="${index + 40}" name="Chart"/>
      <p:cNvGraphicFramePr/>
      <p:nvPr/>
    </p:nvGraphicFramePr>
    <p:xfrm><a:off x="914400" y="2286000"/><a:ext cx="9144000" cy="3657600"/></p:xfrm>
    <a:graphic>
      <a:graphicData uri="${C}">
        <c:chart xmlns:c="${C}" xmlns:r="${R}" r:id="${relId}"/>
      </a:graphicData>
    </a:graphic>
  </p:graphicFrame>`
}

function smartArtXml(index: number) {
  return `<p:graphicFrame>
    <p:nvGraphicFramePr>
      <p:cNvPr id="${index + 60}" name="SmartArt"/>
      <p:cNvGraphicFramePr/>
      <p:nvPr/>
    </p:nvGraphicFramePr>
    <p:xfrm><a:off x="914400" y="914400"/><a:ext cx="9144000" cy="4572000"/></p:xfrm>
    <a:graphic>
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">
        <dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId99" r:lo="rId98" r:qs="rId97" r:cs="rId96" xmlns:r="${R}"/>
      </a:graphicData>
    </a:graphic>
  </p:graphicFrame>`
}

function barChartXml(cache: string, cats: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}">
  <c:chart>
    <c:plotArea>
      <c:barChart>
        <c:ser>
          <c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>Revenue</c:v></c:pt></c:strCache></c:strRef></c:tx>
          <c:cat><c:strRef><c:f>Sheet1!$A$2:$A$5</c:f>${cats}</c:strRef></c:cat>
          <c:val><c:numRef><c:f>Sheet1!$B$2:$B$5</c:f>${cache}</c:numRef></c:val>
        </c:ser>
      </c:barChart>
    </c:plotArea>
  </c:chart>
</c:chartSpace>`
}

function chartXml(kind: NonNullable<FixtureSlide['chart']>) {
  if (kind === 'scatter') {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}">
  <c:chart>
    <c:plotArea>
      <c:scatterChart>
        <c:ser>
          <c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>Points</c:v></c:pt></c:strCache></c:strRef></c:tx>
          <c:xVal><c:numRef><c:f>Sheet1!$A$2:$A$3</c:f><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>1.5</c:v></c:pt><c:pt idx="1"><c:v>2.5</c:v></c:pt></c:numCache></c:numRef></c:xVal>
          <c:yVal><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:yVal>
        </c:ser>
      </c:scatterChart>
    </c:plotArea>
  </c:chart>
</c:chartSpace>`
  }
  const cats = `<c:strCache><c:ptCount val="4"/><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt><c:pt idx="2"><c:v>Q3</c:v></c:pt><c:pt idx="3"><c:v>Q4</c:v></c:pt></c:strCache>`
  if (kind === 'blank-point') {
    return barChartXml(
      `<c:numCache><c:ptCount val="4"/><c:pt idx="0"><c:v>4.2</c:v></c:pt><c:pt idx="1"><c:v>#N/A</c:v></c:pt><c:pt idx="2"><c:v>4.8</c:v></c:pt><c:pt idx="3"><c:v></c:v></c:pt></c:numCache>`,
      cats,
    )
  }
  if (kind === 'uncached') return barChartXml('', '')
  return barChartXml(
    `<c:numCache><c:ptCount val="4"/><c:pt idx="0"><c:v>4.2</c:v></c:pt><c:pt idx="1"><c:v>5.1</c:v></c:pt><c:pt idx="2"><c:v>4.8</c:v></c:pt><c:pt idx="3"><c:v>6.3</c:v></c:pt></c:numCache>`,
    cats,
  )
}

function notesXml(notes: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Notes"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr><p:ph type="body"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>${xfrm(0, 0, 4_000_000, 1_000_000)}</p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1200"/><a:t>${escapeXml(notes)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>`
}

function slideXml(body: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/><a:chOff x="0" y="0"/><a:chExt cx="12192000" cy="6858000"/></a:xfrm></p:grpSpPr>
      ${body}
    </p:spTree>
  </p:cSld>
</p:sld>`
}

function relsXml(entries: Array<{ id: string; type: string; target: string }>) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL}">
${entries.map((entry) => `  <Relationship Id="${entry.id}" Type="${entry.type}" Target="${entry.target}"/>`).join('\n')}
</Relationships>`
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function contentTypes(parts: string[]) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT}">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  ${parts.join('\n  ')}
</Types>`
}

export async function buildPptx(options: BuildPptxOptions): Promise<Uint8Array> {
  const zip = new JSZip()
  const slides = options.slides
  const presentationRels: Array<{ id: string; type: string; target: string }> = [
    { id: 'rIdTheme', type: THEME_REL, target: 'theme/theme1.xml' },
  ]
  const overrides: string[] = []
  const sldIds: string[] = []

  zip.file('ppt/theme/theme1.xml', THEME_XML)
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(options.title ?? 'Fixture Deck')}</dc:title></cp:coreProperties>`,
  )

  for (const [index, slide] of slides.entries()) {
    const slideNum = index + 1
    const slidePath = `ppt/slides/slide${slideNum}.xml`
    const slideRelId = `rIdSlide${slideNum}`
    presentationRels.push({
      id: slideRelId,
      type: SLIDE_REL,
      target: `slides/slide${slideNum}.xml`,
    })
    sldIds.push(`<p:sldId id="${256 + index}" r:id="${slideRelId}"/>`)
    overrides.push(
      `<Override PartName="/ppt/slides/slide${slideNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )

    const slideRels: Array<{ id: string; type: string; target: string }> = []
    const body: string[] = []
    for (const [shapeIndex, shape] of (slide.shapes ?? []).entries()) {
      body.push(shapeXml(shape, shapeIndex))
    }
    if (slide.picture) {
      const ext = slide.picture === 'emf' || slide.picture === 'wmf' ? slide.picture : 'png'
      slideRels.push({ id: 'rIdImg', type: IMAGE_REL, target: `../media/image1.${ext}` })
      body.push(pictureXml('rIdImg', index))
      zip.file(`ppt/media/image1.${ext}`, TINY_PNG)
    }
    if (slide.chart) {
      const chartPart = `ppt/charts/chart${slideNum}.xml`
      slideRels.push({ id: 'rIdChart', type: CHART_REL, target: `../charts/chart${slideNum}.xml` })
      body.push(chartFrameXml('rIdChart', index))
      zip.file(chartPart, chartXml(slide.chart))
      overrides.push(
        `<Override PartName="/ppt/charts/chart${slideNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
      )
    }
    if (slide.smartArt) body.push(smartArtXml(index))
    if (slide.notes) {
      const notesPart = `ppt/notesSlides/notesSlide${slideNum}.xml`
      slideRels.push({
        id: 'rIdNotes',
        type: NOTES_REL,
        target: `../notesSlides/notesSlide${slideNum}.xml`,
      })
      zip.file(notesPart, notesXml(slide.notes))
      overrides.push(
        `<Override PartName="/ppt/notesSlides/notesSlide${slideNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`,
      )
    }

    zip.file(slidePath, slideXml(body.join('\n')))
    zip.file(`ppt/slides/_rels/slide${slideNum}.xml.rels`, relsXml(slideRels))
  }

  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="${P}" xmlns:r="${R}">
  <p:sldIdLst>${sldIds.join('')}</p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
</p:presentation>`,
  )
  zip.file('ppt/_rels/presentation.xml.rels', relsXml(presentationRels))
  zip.file(
    '_rels/.rels',
    relsXml([{ id: 'rId1', type: OFFICEDOC, target: 'ppt/presentation.xml' }]),
  )
  zip.file('[Content_Types].xml', contentTypes(overrides))

  return zip.generateAsync({ type: 'uint8array' })
}

export function buildLegacyPpt(): Uint8Array {
  const header = Buffer.from(OLE_MAGIC)
  const name = Buffer.from('PowerPoint Document', 'utf16le')
  return new Uint8Array(Buffer.concat([header, Buffer.alloc(64, 0), name, Buffer.alloc(32, 0)]))
}

export async function buildEncryptedPptx(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('EncryptionInfo', Buffer.from('agile-encryption'))
  zip.file('EncryptedPackage', Buffer.from('ciphertext'))
  return zip.generateAsync({ type: 'uint8array' })
}

export async function buildCorruptXmlPptx(): Promise<Uint8Array> {
  const bytes = await buildPptx({
    title: 'Corrupt',
    slides: [{ shapes: [{ text: 'Broken' }] }],
  })
  const zip = await JSZip.loadAsync(bytes)
  zip.file('ppt/slides/slide1.xml', '<p:sld><not-closed')
  return zip.generateAsync({ type: 'uint8array' })
}
