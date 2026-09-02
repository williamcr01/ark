import { MAX_CHAT_ATTACHMENT_BYTES } from '@ark/chat/attachments.ts'

export function formatAttachmentError(error: { code: string; message: string }) {
  switch (error.code) {
    case 'max_file_size':
      return `Each attachment must be ${Math.round(MAX_CHAT_ATTACHMENT_BYTES / (1024 * 1024))} MB or smaller.`
    default:
      return error.message
  }
}
