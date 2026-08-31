export { importPptxToHtml, type ImportedPptxDeck, type ImportPptxOptions } from './import-pptx.ts'
export {
  PptxImportError,
  isPptxImportError,
  PPTX_IMPORT_ERROR_CODES,
  PPTX_LEGACY_MESSAGE,
  PPTX_ENCRYPTED_MESSAGE,
  PPTX_INVALID_MESSAGE,
  type PptxImportErrorCode,
} from './errors.ts'
export { filenameExtension } from './detect.ts'
