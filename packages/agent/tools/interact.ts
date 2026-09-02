import { tool } from 'ai'
import { z } from 'zod'

import { agentQuestionRequestSchema } from '@ark/chat/agent-questions.ts'
import { themeProposalRequestSchema } from '@ark/chat/agent-themes.ts'
import { evaluateThemeSampleHtml } from '@ark/deck-node/document/theme-html.ts'
import { validateDeckHtmlOnServer } from '@ark/deck-node/validate/timed.ts'
import type { Logger } from '@ark/telemetry/logger.ts'
import type { DeckAttachmentInspector } from './helpers.ts'

export function createInteractionDeckTools(options: {
  logger?: Logger
  attachmentInspector?: DeckAttachmentInspector
}) {
  const { logger, attachmentInspector } = options
  const timingOptions = logger ? { logger } : {}

  return {
    ask_user: tool({
      description:
        'Ask the user up to five concise questions when critical context is missing. Supports single choice, multiple choice, and free text. Call this instead of guessing, then stop and wait for the next user message.',
      inputSchema: agentQuestionRequestSchema,
      execute: async ({ questions }) => ({
        ok: true,
        awaitingUserResponse: true,
        message: `Waiting for answers to ${questions.length} question(s).`,
      }),
    }),
    propose_themes: tool({
      description:
        'Propose exactly four visually distinct theme directions. Each candidate needs a full theme spec (fonts, colors, type, spacing, slide recipes), a one-line rationale, and a lean three-slide sampleHtml (cover, content, and one of section/data/closing) using --ark-* CSS variables. Use before creating a new deck, or when the user explicitly asks to retheme the whole existing deck, then stop and wait for the user to pick one.',
      inputSchema: themeProposalRequestSchema,
      execute: async ({ themes }) => executeProposeThemes(themes, timingOptions),
    }),
    list_attachments: tool({
      description:
        'List all files attached to this deck conversation. Use before reading reference material or placing attached images in the deck.',
      inputSchema: z.object({}),
      execute: async () => ({
        attachmentCount: attachmentInspector?.attachments.length ?? 0,
        attachments: attachmentInspector?.attachments ?? [],
      }),
    }),
    read_attachment: tool({
      description:
        'Read a UTF-8 text, CSV, Markdown, or JSON attachment by byte offset. For binary files, returns metadata and the exact Ark URL to place in the deck; do not copy bytes or invent a URL.',
      inputSchema: z.object({
        id: z.string().describe('Attachment id from list_attachments.'),
        offset: z.number().int().min(0).optional().describe('UTF-8 byte offset.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(64 * 1024)
          .optional()
          .describe('Maximum bytes to return, up to 64 KiB.'),
      }),
      execute: async ({ id, offset = 0, limit = 32 * 1024 }) =>
        executeReadAttachment(attachmentInspector, id, offset, limit),
    }),
  }
}

async function executeProposeThemes(
  themes: Array<{ id: string; name: string; sampleHtml: string; theme: unknown }>,
  timingOptions: { logger?: Logger },
) {
  for (const candidate of themes) {
    const validation = validateDeckHtmlOnServer(candidate.sampleHtml, timingOptions)
    if (!validation.valid) {
      const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')
      return {
        ok: false,
        error: `Theme "${candidate.name}" sampleHtml failed validation: ${primaryIssue?.message ?? 'invalid HTML'}`,
        themeId: candidate.id,
      }
    }
    const sampleIssues = evaluateThemeSampleHtml(
      candidate.sampleHtml,
      candidate.theme as Parameters<typeof evaluateThemeSampleHtml>[1],
    )
    if (sampleIssues.length > 0) {
      return {
        ok: false,
        error: `Theme "${candidate.name}" sampleHtml does not follow its theme spec: ${sampleIssues.map((issue) => issue.message).join(' ')}`,
        themeId: candidate.id,
        sampleIssues,
      }
    }
  }

  return {
    ok: true,
    awaitingUserResponse: true,
    message: 'Waiting for the user to pick a theme.',
  }
}

async function executeReadAttachment(
  attachmentInspector: DeckAttachmentInspector | undefined,
  id: string,
  offset: number,
  limit: number,
) {
  if (!attachmentInspector) {
    return { error: 'No attachments available for this conversation.' }
  }
  const attachment = attachmentInspector.attachments.find((item) => item.id === id)
  if (!attachment) return { error: 'Attachment not found.' }
  if (!attachment.mediaType.startsWith('text/') && attachment.mediaType !== 'application/json') {
    return {
      ...attachment,
      binary: true,
      message: 'Binary attachment. Use this exact Ark URL when placing it in the deck.',
    }
  }
  const bytes = await attachmentInspector.read(id)
  if (!bytes) return { error: 'Attachment bytes are unavailable.' }
  const end = Math.min(bytes.length, offset + limit)
  return {
    ...attachment,
    offset,
    nextOffset: end < bytes.length ? end : undefined,
    content: bytes.subarray(offset, end).toString('utf8'),
  }
}
