export const PPTX_IMPORT_ERROR_CODES = ['pptx_legacy', 'pptx_encrypted', 'pptx_invalid'] as const

export type PptxImportErrorCode = (typeof PPTX_IMPORT_ERROR_CODES)[number]

export class PptxImportError extends Error {
  readonly code: PptxImportErrorCode

  constructor(message: string, code: PptxImportErrorCode) {
    super(message)
    this.name = 'PptxImportError'
    this.code = code
  }
}

export function isPptxImportError(error: unknown): error is PptxImportError {
  return error instanceof PptxImportError
}

export const PPTX_LEGACY_MESSAGE =
  'Legacy .ppt files are not supported. Save the deck as .pptx and import it again.'

export const PPTX_ENCRYPTED_MESSAGE =
  'This PowerPoint file is password-protected. Remove the password, save as .pptx, and import it again.'

export const PPTX_INVALID_MESSAGE = 'That file is not a valid PowerPoint (.pptx) presentation.'
