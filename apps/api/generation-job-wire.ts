import type { GenerationJob } from '@ark/deck-core/generation-job.ts'
import { deckValidationReportSchema } from '@ark/contracts'
import type { GenerationJobApi } from '@ark/contracts'

/** Map a process-local generation job to the REST wire shape (no request body or HTML). */
export function toGenerationJobApi(job: GenerationJob): GenerationJobApi {
  return {
    id: job.id,
    deckId: job.deckId,
    baseDocumentRevision: job.baseDocumentRevision,
    editingExistingDeck: job.request.editingExistingDeck ?? false,
    status: job.status,
    model: job.model,
    provider: job.provider,
    progress: job.progress,
    observability: job.observability ?? null,
    result: job.result
      ? {
          deckId: job.result.deckId,
          documentRevision: job.result.documentRevision,
          validation: deckValidationReportSchema.parse(job.result.validation),
          assistantText: job.result.assistantText,
        }
      : null,
    error: job.error,
    retryOfJobId: job.retryOfJobId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  }
}
