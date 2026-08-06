import { z } from 'zod'

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
    })
    .nullable()
    .optional(),
})

export const mcpToolResponseSchema = z.object({
  text: z.string(),
  structuredContent: z.record(z.string(), z.unknown()),
  isError: z.boolean().optional(),
})

export type McpToolResponse = z.infer<typeof mcpToolResponseSchema>
