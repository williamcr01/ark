import { randomUUID } from 'node:crypto'

import type { ChatMessagePart } from '@ark/chat/chat.ts'
import type {
  GenerationJob,
  GenerationJobObservability,
  GenerationJobStatus,
} from '@ark/chat/generation-job.ts'
import { validateDeckHtmlOnServer } from '@ark/deck-node/validate/timed.ts'
import {
  persistAssistantGenerationMessage,
  persistInitialDeckChatHistory,
} from '@ark/storage/records/chat-persistence.ts'
import type { RunDeckAgentResult } from '../agent.ts'
import type { JobContext } from './context.ts'

type SucceededAgentResult = Extract<RunDeckAgentResult, { ok: true }>

export async function persistTerminalAssistantMessage(
  ctx: JobContext,
  job: GenerationJob,
  options: {
    status: GenerationJobStatus
    steps: GenerationJob['progress']['steps']
    transcriptParts?: ChatMessagePart[]
    assistantText?: string | null
    deckId: string
    error?: GenerationJob['error']
  },
) {
  if (!ctx.stores.chatStore) {
    return
  }

  await persistAssistantGenerationMessage(ctx.stores.chatStore, options.deckId, {
    jobId: job.id,
    model: job.model,
    status: options.status,
    steps: options.steps,
    transcriptParts: options.transcriptParts,
    assistantText: options.assistantText,
    editingExistingDeck: job.request.editingExistingDeck ?? false,
    error: options.error ?? null,
  })
}

export async function persistJobResult(
  ctx: JobContext,
  refreshed: GenerationJob,
  agentResult: SucceededAgentResult,
  observability: GenerationJobObservability,
) {
  const targetDeckId = refreshed.deckId
  const baseDocumentRevision = refreshed.baseDocumentRevision

  if (
    !targetDeckId &&
    (agentResult.awaitingUserResponse ||
      (agentResult.changed === false && !agentResult.html.trim()))
  ) {
    await persistNoDeckSuccess(ctx, agentResult, observability)
    return
  }

  if (targetDeckId) {
    await persistExistingDeckResult(
      ctx,
      refreshed,
      agentResult,
      observability,
      targetDeckId,
      baseDocumentRevision,
    )
    return
  }

  await persistCreatedDeck(ctx, refreshed, agentResult, observability)
}

async function persistNoDeckSuccess(
  ctx: JobContext,
  agentResult: SucceededAgentResult,
  observability: GenerationJobObservability,
) {
  await ctx.stores.jobStore.updateJob(ctx.job.id, {
    status: 'succeeded',
    progress: {
      steps: agentResult.steps,
      stepCount: agentResult.steps.length,
      assistantText: agentResult.assistantText,
      transcriptParts: agentResult.transcriptParts,
    },
    result: null,
    observability,
    completedAt: ctx.now().toISOString(),
  })

  ctx.logger.info('generation.job.succeeded', {
    changed: false,
    awaitingUserResponse: true,
    durationMs: observability.durationMs,
    stepCount: agentResult.steps.length,
    tokenUsage: agentResult.providerMetrics?.tokenUsage ?? null,
  })
}

async function persistExistingDeckResult(
  ctx: JobContext,
  refreshed: GenerationJob,
  agentResult: SucceededAgentResult,
  observability: GenerationJobObservability,
  targetDeckId: string,
  baseDocumentRevision: number | null,
) {
  const existingDeck = await ctx.stores.deckStore.getDeck(targetDeckId)

  if (!existingDeck) {
    await failPersistWithProgress(ctx, agentResult, observability, {
      message: 'The target deck no longer exists.',
      code: 'deck_not_found',
    })
    return
  }

  const currentDocumentRevision = existingDeck.documentRevision

  if (baseDocumentRevision !== null && baseDocumentRevision !== currentDocumentRevision) {
    await failPersistWithProgress(ctx, agentResult, observability, {
      message: 'The deck changed while generation was running. Retry from the latest document.',
      code: 'document_conflict',
    })
    return
  }

  if (agentResult.changed === false) {
    await persistUnchangedExistingDeck(
      ctx,
      refreshed,
      agentResult,
      observability,
      existingDeck.id,
      existingDeck.documentRevision,
      existingDeck.html,
    )
    return
  }

  await persistUpdatedDeck(ctx, agentResult, observability, targetDeckId, currentDocumentRevision)
}

async function persistUnchangedExistingDeck(
  ctx: JobContext,
  refreshed: GenerationJob,
  agentResult: SucceededAgentResult,
  observability: GenerationJobObservability,
  deckId: string,
  documentRevision: number,
  html: string,
) {
  // Persist chat before marking the job terminal so clients (and tests)
  // that poll job status then read chat never observe a succeeded job
  // without its assistant turn.
  await persistTerminalAssistantMessage(ctx, refreshed, {
    status: 'succeeded',
    steps: agentResult.steps,
    transcriptParts: agentResult.transcriptParts,
    assistantText: agentResult.assistantText,
    deckId,
  })

  await ctx.stores.jobStore.updateJob(ctx.job.id, {
    status: 'succeeded',
    deckId,
    progress: {
      steps: agentResult.steps,
      stepCount: agentResult.steps.length,
      assistantText: agentResult.assistantText,
      ...(agentResult.awaitingUserResponse ? { transcriptParts: agentResult.transcriptParts } : {}),
    },
    result: {
      deckId,
      documentRevision,
      html,
      validation: agentResult.validation,
      assistantText: agentResult.assistantText,
    },
    observability,
    completedAt: ctx.now().toISOString(),
  })

  ctx.logger.info('generation.job.succeeded', {
    changed: false,
    awaitingUserResponse: Boolean(agentResult.awaitingUserResponse),
    durationMs: observability.durationMs,
    stepCount: agentResult.steps.length,
    tokenUsage: agentResult.providerMetrics?.tokenUsage ?? null,
  })
}

async function persistUpdatedDeck(
  ctx: JobContext,
  agentResult: SucceededAgentResult,
  observability: GenerationJobObservability,
  targetDeckId: string,
  currentDocumentRevision: number,
) {
  const updatedDeck = await ctx.stores.deckStore.updateDeck(targetDeckId, agentResult.html, {
    expectedDocumentRevision: currentDocumentRevision,
    historySource: 'agent',
  })

  if (!updatedDeck) {
    const failedJob = await ctx.stores.jobStore.updateJob(ctx.job.id, {
      status: 'failed',
      error: {
        message: 'Could not save the generated deck.',
        code: 'save_failed',
      },
      observability,
      completedAt: ctx.now().toISOString(),
    })

    if (failedJob?.deckId) {
      await persistTerminalAssistantMessage(ctx, failedJob, {
        status: 'failed',
        steps: agentResult.steps,
        transcriptParts: agentResult.transcriptParts,
        deckId: failedJob.deckId,
        error: failedJob.error,
      })
    }

    return
  }

  const succeededJob = await ctx.stores.jobStore.updateJob(ctx.job.id, {
    deckId: updatedDeck.id,
    progress: {
      steps: agentResult.steps,
      stepCount: agentResult.steps.length,
      assistantText: agentResult.assistantText,
    },
    result: {
      deckId: updatedDeck.id,
      documentRevision: updatedDeck.documentRevision,
      html: updatedDeck.html,
      validation: agentResult.validation,
      assistantText: agentResult.assistantText,
    },
    observability,
  })

  if (succeededJob) {
    await persistTerminalAssistantMessage(ctx, succeededJob, {
      status: 'succeeded',
      steps: agentResult.steps,
      transcriptParts: agentResult.transcriptParts,
      assistantText: agentResult.assistantText,
      deckId: updatedDeck.id,
    })
  }

  await ctx.stores.jobStore.updateJob(ctx.job.id, {
    status: 'succeeded',
    completedAt: ctx.now().toISOString(),
  })

  ctx.logger.info('generation.job.succeeded', {
    durationMs: observability.durationMs,
    stepCount: agentResult.steps.length,
    tokenUsage: agentResult.providerMetrics?.tokenUsage ?? null,
  })

  ctx.deps.onDocumentPersisted?.(updatedDeck.id, updatedDeck.documentRevision)
}

async function persistCreatedDeck(
  ctx: JobContext,
  refreshed: GenerationJob,
  agentResult: SucceededAgentResult,
  observability: GenerationJobObservability,
) {
  const newDeckId = randomUUID()
  const finalizedHtml = agentResult.html
  const finalValidation = validateDeckHtmlOnServer(finalizedHtml, { logger: ctx.logger })
  if (!finalValidation.valid) {
    throw new Error(
      finalValidation.issues.find((issue) => issue.severity === 'error')?.message ??
        'Finalized deck HTML is invalid.',
    )
  }

  const createdDeck = await ctx.stores.deckStore.createDeck(finalizedHtml, undefined, newDeckId)

  if (ctx.stores.chatStore) {
    await persistInitialDeckChatHistory(
      ctx.stores.chatStore,
      createdDeck.id,
      refreshed.request.messages,
    )
  }

  const preparedJob = await ctx.stores.jobStore.updateJob(ctx.job.id, {
    deckId: createdDeck.id,
    progress: {
      steps: agentResult.steps,
      stepCount: agentResult.steps.length,
      assistantText: agentResult.assistantText,
    },
    result: {
      deckId: createdDeck.id,
      documentRevision: createdDeck.documentRevision,
      html: createdDeck.html,
      validation: finalValidation,
      assistantText: agentResult.assistantText,
    },
    observability,
  })

  if (preparedJob) {
    await persistTerminalAssistantMessage(ctx, preparedJob, {
      status: 'succeeded',
      steps: agentResult.steps,
      transcriptParts: agentResult.transcriptParts,
      assistantText: agentResult.assistantText,
      deckId: createdDeck.id,
    })
  }

  await ctx.stores.jobStore.updateJob(ctx.job.id, {
    status: 'succeeded',
    completedAt: ctx.now().toISOString(),
  })

  ctx.logger.info('generation.job.succeeded', {
    durationMs: observability.durationMs,
    stepCount: agentResult.steps.length,
    tokenUsage: agentResult.providerMetrics?.tokenUsage ?? null,
  })

  ctx.deps.onDocumentPersisted?.(createdDeck.id, createdDeck.documentRevision)
}

async function failPersistWithProgress(
  ctx: JobContext,
  agentResult: SucceededAgentResult,
  observability: GenerationJobObservability,
  error: { message: string; code: string },
) {
  const failedJob = await ctx.stores.jobStore.updateJob(ctx.job.id, {
    status: 'failed',
    progress: {
      steps: agentResult.steps,
      stepCount: agentResult.steps.length,
      assistantText: agentResult.assistantText,
    },
    error,
    observability,
    completedAt: ctx.now().toISOString(),
  })

  if (failedJob?.deckId) {
    await persistTerminalAssistantMessage(ctx, failedJob, {
      status: 'failed',
      steps: agentResult.steps,
      transcriptParts: agentResult.transcriptParts,
      assistantText: agentResult.assistantText,
      deckId: failedJob.deckId,
      error: failedJob.error,
    })
  }
}
