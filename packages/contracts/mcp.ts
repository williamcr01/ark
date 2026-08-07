import { z } from 'zod'

import { agentQuestionRequestSchema } from '@ark/deck-core/agent-questions.ts'
import { themeProposalRequestSchema } from '@ark/deck-core/agent-themes.ts'
import { deckIdSchema } from './common.ts'

export const mcpServiceStateSchema = z.enum(['stopped', 'running', 'stopping'])

export const mcpActivitySchema = z.object({
  clientName: z.string().nullable(),
  toolName: z.string(),
  summary: z.string(),
  occurredAt: z.string(),
})

export const mcpStatusSchema = z.object({
  state: mcpServiceStateSchema,
  autoStart: z.boolean(),
  activeDeckId: deckIdSchema.nullable(),
  activeDeckTitle: z.string().nullable(),
  connectedClient: z.string().nullable(),
  lastActivity: mcpActivitySchema.nullable(),
  error: z.string().nullable(),
})

export type McpStatus = z.infer<typeof mcpStatusSchema>

export const mcpActivityEventSchema = mcpActivitySchema.extend({
  failed: z.boolean(),
})

export type McpActivityEvent = z.infer<typeof mcpActivityEventSchema>

export const mcpSetupCommandsSchema = z.object({
  codex: z.string(),
  claudeCode: z.string(),
})

export type McpSetupCommands = z.infer<typeof mcpSetupCommandsSchema>

export const mcpInteractionStatusSchema = z.enum([
  'pending',
  'answered',
  'canceled',
  'stale',
  'expired',
])

const mcpInteractionBaseSchema = z.object({
  id: z.string().uuid(),
  deckId: deckIdSchema,
  baseDocumentRevision: z.number().int().min(1),
  clientName: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
})

export const mcpQuestionAnswersSchema = z.record(
  z.string().min(1).max(64),
  z.union([z.string().max(4_000), z.array(z.string().max(1_000)).max(20)]),
)

export const mcpPendingInteractionSchema = z.discriminatedUnion('kind', [
  mcpInteractionBaseSchema.extend({
    kind: z.literal('questions'),
    request: agentQuestionRequestSchema,
  }),
  mcpInteractionBaseSchema.extend({
    kind: z.literal('themes'),
    request: themeProposalRequestSchema,
  }),
])

export type McpPendingInteraction = z.infer<typeof mcpPendingInteractionSchema>

export const mcpInteractionAnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('questions'), answers: mcpQuestionAnswersSchema }),
  z.object({ kind: z.literal('themes'), themeId: z.string().min(1).max(64) }),
])

export type McpInteractionAnswer = z.infer<typeof mcpInteractionAnswerSchema>

export const mcpInteractionChangedSchema = z.object({
  interaction: mcpPendingInteractionSchema.nullable(),
})

export type McpInteractionChanged = z.infer<typeof mcpInteractionChangedSchema>

export const externalDeckUpdateSchema = z.object({
  deckId: deckIdSchema,
  previousDocumentRevision: z.number().int().min(1),
  documentRevision: z.number().int().min(1),
  clientName: z.string().nullable(),
  toolName: z.string(),
  summary: z.string(),
})

export type ExternalDeckUpdate = z.infer<typeof externalDeckUpdateSchema>

export const mcpToolRequestSchema = z.object({
  arguments: z.record(z.string(), z.unknown()),
  client: z
    .object({
      name: z.string().min(1).max(100),
      version: z.string().max(100).optional(),
      sessionId: z.string().uuid().optional(),
    })
    .nullable()
    .optional(),
})

export const mcpToolResponseSchema = z.object({
  text: z.string(),
  activitySummary: z.string().max(500).optional(),
  structuredContent: z.record(z.string(), z.unknown()),
  isError: z.boolean().optional(),
})

export type McpToolResponse = z.infer<typeof mcpToolResponseSchema>
