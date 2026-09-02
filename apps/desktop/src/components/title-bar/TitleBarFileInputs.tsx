import type { ChangeEvent, RefObject } from 'react'

export function TitleBarFileInputs({
  fileInputRef,
  onHtmlUpload,
  onPptxUpload,
  pptxFileInputRef,
}: {
  fileInputRef: RefObject<HTMLInputElement | null>
  onHtmlUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onPptxUpload: (event: ChangeEvent<HTMLInputElement>) => void
  pptxFileInputRef: RefObject<HTMLInputElement | null>
}) {
  return (
    <>
      <input
        accept=".html,.htm,text/html"
        className="hidden"
        onChange={onHtmlUpload}
        ref={fileInputRef}
        type="file"
      />
      <input
        accept=".pptx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        className="hidden"
        onChange={onPptxUpload}
        ref={pptxFileInputRef}
        type="file"
      />
    </>
  )
}
