import { z } from 'zod'

import { agentQuestionRequestSchema } from '@ark/chat/agent-questions.ts'
import {
  themeCandidateSchema,
  themeFontPairingSchema,
  themeProposalRequestObjectSchema,
  themeProposalRequestSchema,
} from '@ark/chat/agent-themes.ts'
import { deckThemeSpecV1Schema } from '@ark/deck/document/theme.ts'
import { deckIdSchema } from './common.ts'

export {
  themeCandidateSchema,
  themeFontPairingSchema,
  themeProposalRequestObjectSchema,
  themeProposalRequestSchema,
}

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

export const MCP_CLIENT_IDS = [
  'codex',
  'claudeCode',
  'grok',
  'cursor',
  'openCode',
  'devinCli',
] as const

export const mcpClientIdSchema = z.enum(MCP_CLIENT_IDS)

export type McpClientId = z.infer<typeof mcpClientIdSchema>

export const mcpClientInstallationStatusSchema = z.enum([
  'notInstalled',
  'installed',
  'needsUpdate',
  'unavailable',
])

export type McpClientInstallationStatus = z.infer<typeof mcpClientInstallationStatusSchema>

export const mcpClientInstallationSchema = z.object({
  clientId: mcpClientIdSchema,
  status: mcpClientInstallationStatusSchema,
  error: z.string().min(1).max(1_000).optional(),
})

export type McpClientInstallation = z.infer<typeof mcpClientInstallationSchema>

export const mcpClientInstallationsSchema = z.array(mcpClientInstallationSchema)

export type McpClientInstallations = z.infer<typeof mcpClientInstallationsSchema>

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

export const mcpThemeSelectAnswerSchema = z.object({
  kind: z.literal('themes'),
  themeId: z.string().min(1).max(64),
  fonts: themeFontPairingSchema,
  theme: deckThemeSpecV1Schema,
})

export const mcpThemeRefreshAnswerSchema = z.object({
  kind: z.literal('themes'),
  refresh: z.literal(true),
})

export const mcpInteractionAnswerSchema = z.union([
  z.object({ kind: z.literal('questions'), answers: mcpQuestionAnswersSchema }),
  mcpThemeRefreshAnswerSchema,
  mcpThemeSelectAnswerSchema,
])

export type McpInteractionAnswer = z.infer<typeof mcpInteractionAnswerSchema>

export function isMcpThemeRefreshAnswer(
  answer: McpInteractionAnswer,
): answer is z.infer<typeof mcpThemeRefreshAnswerSchema> {
  return answer.kind === 'themes' && 'refresh' in answer && answer.refresh === true
}

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
