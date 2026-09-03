import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from '@/components/ai-elements/attachments'
import type { ChatAttachment } from '@ark/chat/attachments.ts'

export function ChatMessageAttachments({ attachments }: { attachments: ChatAttachment[] }) {
  if (attachments.length === 0) {
    return null
  }

  return (
    <Attachments className="mt-2" variant="inline">
      {attachments.map((attachment, index) => (
        <Attachment
          data={{
            ...attachment,
            id: `${attachment.filename ?? 'attachment'}-${index}`,
          }}
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- append-only per-message attachment list: ChatAttachment has no stable id and attachments never reorder/filter after send (rule's documented suppression)
          key={`${attachment.filename ?? 'attachment'}-${index}`}
        >
          <AttachmentPreview />
          <AttachmentInfo />
        </Attachment>
      ))}
    </Attachments>
  )
}
