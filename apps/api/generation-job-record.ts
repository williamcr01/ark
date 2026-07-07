import type {
  CreateGenerationJobInput,
  GenerationJob,
  GenerationJobError,
  GenerationJobObservability,
  GenerationJobProgress,
  GenerationJobRequest,
  GenerationJobResult,
  GenerationJobStatus,
} from '@ark/deck-core/generation-job.ts'

type GenerationJobPatch = Partial<{
  status: GenerationJobStatus
  deckId: string | null
  progress: GenerationJobProgress
  result: GenerationJobResult | null
  error: GenerationJobError | null
  observability: GenerationJobObservability | null
  startedAt: string | null
  completedAt: string | null
}>

export type GenerationJobStore = {
  createJob: (input: CreateGenerationJobInput) => Promise<GenerationJob>
  getJob: (id: string) => Promise<GenerationJob | null>
  claimQueuedJob: (id: string, startedAt: string) => Promise<GenerationJob | null>
  updateJob: (id: string, patch: GenerationJobPatch) => Promise<GenerationJob | null>
  updateJobIfStatus: (
    id: string,
    expectedStatus: GenerationJobStatus,
    patch: GenerationJobPatch,
  ) => Promise<GenerationJob | null>
  listJobsForDeck: (deckId: string) => Promise<GenerationJob[]>
}

import { isValidGenerationJobId } from '@ark/contracts'

export { isValidGenerationJobId }

export function createEmptyGenerationJobProgress(): GenerationJobProgress {
  return {
    steps: [],
    stepCount: 0,
    assistantText: null,
  }
}

export function cloneGenerationJobRequest(request: GenerationJobRequest): GenerationJobRequest {
  return {
    messages: request.messages.map((message) => ({
      ...message,
      ...(message.attachments ? { attachments: [...message.attachments] } : {}),
    })),
    currentHtml: request.currentHtml,
    baseVersionId: request.baseVersionId ?? null,
    editingExistingDeck: request.editingExistingDeck ?? false,
  }
}
