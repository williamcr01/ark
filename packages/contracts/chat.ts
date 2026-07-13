import { z } from 'zod'

import { deckIdSchema, withRequestId } from './common.ts'
import {
  MAX_PERSISTED_ASSISTANT_TURN_BYTES,
  MAX_PERSISTED_TOOL_VALUE_BYTES,
  parseChatAttachments,
} from '@ark/deck-core/chat.ts'
import type { JsonValue } from '@ark/deck-core/chat.ts'

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

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return !!value && typeof value === 'object' && Object.values(value).every(isJsonValue)
}

export const jsonValueSchema = z
  .unknown()
  .refine(isJsonValue, 'Expected a JSON-safe value')
  .transform((value) => value as JsonValue)

const transcriptRecoverySchema = z.object({
  toolName: z.string(),
  input: jsonValueSchema,
  instruction: z.string(),
})

export const chatMessagePartSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    content: z.string(),
    stepIndex: z.number().int().min(0).optional(),
  }),
  z.object({
    type: z.literal('tool-call'),
    toolName: z.string(),
    summary: z.string(),
    stepIndex: z.number().int().min(0).optional(),
    toolCallId: z.string().optional(),
    input: jsonValueSchema.optional(),
    mutating: z.boolean().optional(),
    truncated: z.boolean().optional(),
    recovery: transcriptRecoverySchema.optional(),
  }),
  z.object({
    type: z.literal('tool-result'),
    toolName: z.string(),
    summary: z.string(),
    error: z.boolean().optional(),
    stepIndex: z.number().int().min(0).optional(),
    toolCallId: z.string().optional(),
    output: jsonValueSchema.optional(),
    isError: z.boolean().optional(),
    mutating: z.boolean().optional(),
    truncated: z.boolean().optional(),
    recovery: transcriptRecoverySchema.optional(),
  }),
])

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

const assistantPartsSchema = z.array(chatMessagePartSchema).superRefine((parts, context) => {
  for (const [index, part] of parts.entries()) {
    const value =
      part.type === 'tool-call' ? part.input : part.type === 'tool-result' ? part.output : undefined
    if (value !== undefined && jsonBytes(value) > MAX_PERSISTED_TOOL_VALUE_BYTES)
      context.addIssue({
        code: 'custom',
        path: [index, part.type === 'tool-call' ? 'input' : 'output'],
        message: `Tool transcript value exceeds the ${MAX_PERSISTED_TOOL_VALUE_BYTES} byte persistence limit.`,
      })
  }
  if (jsonBytes(parts) > MAX_PERSISTED_ASSISTANT_TURN_BYTES)
    context.addIssue({
      code: 'custom',
      message: `Assistant transcript exceeds the ${MAX_PERSISTED_ASSISTANT_TURN_BYTES} byte persistence limit.`,
    })
})

export const chatAttachmentSchema = z.object({
  type: z.literal('file'),
  mediaType: z.string(),
  filename: z.string().optional(),
  url: z.string(),
  assetId: z.string().optional(),
})

/** API chat turn sent with generation jobs and chat append requests. */
export const apiChatMessageSchema = z.discriminatedUnion('role', [
  z.object({
    id: z.string().optional(),
    role: z.literal('user'),
    content: z.string(),
    attachments: z.array(chatAttachmentSchema).optional(),
  }),
  z.object({
    id: z.string().optional(),
    role: z.literal('assistant'),
    content: z.string(),
    attachments: z.array(chatAttachmentSchema).optional(),
    parts: assistantPartsSchema.optional(),
  }),
])

export type ApiChatMessageWire = z.infer<typeof apiChatMessageSchema>

export const persistedChatMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  deckId: z.string().min(1),
  deckVersionId: deckIdSchema.nullable(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  parts: assistantPartsSchema.optional(),
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
    parts: assistantPartsSchema.optional(),
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
