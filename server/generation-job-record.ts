import type {
  CreateGenerationJobInput,
  GenerationJob,
  GenerationJobError,
  GenerationJobProgress,
  GenerationJobRequest,
  GenerationJobResult,
  GenerationJobStatus,
} from '../shared/generation-job.ts'

type GenerationJobPatch = Partial<{
  status: GenerationJobStatus
  deckId: string | null
  progress: GenerationJobProgress
  result: GenerationJobResult | null
  error: GenerationJobError | null
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

const GENERATION_JOB_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidGenerationJobId(id: string) {
  return GENERATION_JOB_ID_PATTERN.test(id)
}

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
