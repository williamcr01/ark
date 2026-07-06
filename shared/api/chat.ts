import { z } from 'zod'

import { deckIdSchema, withRequestId } from './common.ts'
import { parseChatAttachments } from '../chat.ts'

export const chatThreadStatusSchema = z.enum(['active', 'archived'])

export const chatThreadSummarySchema = z.object({
  id: z.string().min(1),
  deckId: z.string().min(1),
  activeDeckVersionId: deckIdSchema.nullable(),
  title: z.string(),
  status: chatThreadStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ChatThreadSummary = z.infer<typeof chatThreadSummarySchema>

export const chatMessageErrorSchema = z.object({
  message: z.string(),
  code: z.string().nullable().optional(),
})

export const chatMessagePartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), content: z.string() }),
  z.object({ type: z.literal('tool-call'), toolName: z.string(), summary: z.string() }),
  z.object({
    type: z.literal('tool-result'),
    toolName: z.string(),
    summary: z.string(),
    error: z.boolean().optional(),
  }),
])

export const chatAttachmentSchema = z.object({
  type: z.literal('file'),
  mediaType: z.string(),
  filename: z.string().optional(),
  url: z.string(),
  assetId: z.string().optional(),
})

export const persistedChatMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  deckId: z.string().min(1),
  deckVersionId: deckIdSchema.nullable(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  parts: z.array(chatMessagePartSchema).optional(),
  attachments: z.array(chatAttachmentSchema).optional(),
  generationJobId: z.string().nullable().optional(),
  generationStatus: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  error: chatMessageErrorSchema.nullable().optional(),
  createdAt: z.string(),
})

export type PersistedChatMessage = z.infer<typeof persistedChatMessageSchema>

export const appendChatMessageRequestSchema = z
  .object({
    id: z.string().optional(),
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    parts: z.array(chatMessagePartSchema).optional(),
    attachments: z.array(chatAttachmentSchema).optional(),
    deckVersionId: deckIdSchema.nullable().optional(),
    generationJobId: z.string().nullable().optional(),
    generationStatus: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    error: chatMessageErrorSchema.nullable().optional(),
  })
  .superRefine((value, context) => {
    const parsedAttachments = parseChatAttachments(value.attachments, 0)

    if (!parsedAttachments.ok) {
      context.addIssue({
        code: 'custom',
        message: parsedAttachments.error,
        path: ['attachments'],
      })
    }
  })

export type AppendChatMessageRequest = z.infer<typeof appendChatMessageRequestSchema>

export const deckChatQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  before: z.string().optional(),
})

export type DeckChatQuery = z.infer<typeof deckChatQuerySchema>

export const deckChatResponseSchema = withRequestId({
  thread: chatThreadSummarySchema.nullable(),
  messages: z.array(persistedChatMessageSchema),
  hasMore: z.boolean(),
})

export type DeckChatResponse = z.infer<typeof deckChatResponseSchema>

export const appendChatMessageResponseSchema = withRequestId({
  message: persistedChatMessageSchema,
})

export type AppendChatMessageResponse = z.infer<typeof appendChatMessageResponseSchema>
