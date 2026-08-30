import { randomUUID } from 'node:crypto'

import {
  TERMINAL_GENERATION_JOB_STATUSES,
  type CreateGenerationJobInput,
  type GenerationJob,
} from '@ark/chat/generation-job.ts'
import {
  type GenerationJobStore,
  cloneGenerationJobRequest,
  createEmptyGenerationJobProgress,
} from '../records/generation-job-record.ts'

export const MAX_RETAINED_TERMINAL_JOBS = 50

/** Generation jobs are deliberately process-local; completed payloads are not workspace data. */
export function createGenerationJobStore(_unusedDirectory?: string): GenerationJobStore {
  const jobs = new Map<string, GenerationJob>()

  const pruneTerminalJobs = () => {
    const terminalIds = [...jobs.values()]
      .filter((job) => TERMINAL_GENERATION_JOB_STATUSES.has(job.status))
      .map((job) => job.id)
    for (const id of terminalIds.slice(0, -MAX_RETAINED_TERMINAL_JOBS)) jobs.delete(id)
  }

  const createJob = async (input: CreateGenerationJobInput) => {
    const now = new Date().toISOString()
    const job: GenerationJob = {
      id: randomUUID(),
      deckId: input.deckId ?? null,
      baseDocumentRevision:
        input.baseDocumentRevision ?? input.request.baseDocumentRevision ?? null,
      chatThreadId: input.chatThreadId ?? null,
      status: 'queued',
      model: input.model,
      provider: input.provider ?? null,
      request: cloneGenerationJobRequest(input.request),
      progress: createEmptyGenerationJobProgress(),
      result: null,
      error: null,
      observability: null,
      retryOfJobId: input.retryOfJobId ?? null,
      assetIds: input.assetIds,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    }
    jobs.set(job.id, structuredClone(job))
    return structuredClone(job)
  }

  const getJob = async (id: string) => structuredClone(jobs.get(id) ?? null)
  const update = async (
    id: string,
    patch: Parameters<GenerationJobStore['updateJob']>[1],
    expectedStatus?: GenerationJob['status'],
  ) => {
    const existing = jobs.get(id)
    if (!existing || (expectedStatus && existing.status !== expectedStatus)) return null
    let updated = { ...existing, ...patch, updatedAt: new Date().toISOString() }
    if (TERMINAL_GENERATION_JOB_STATUSES.has(updated.status)) {
      updated = {
        ...updated,
        request: {
          ...updated.request,
          ...(updated.status === 'succeeded' ? { messages: [] } : {}),
          ...(updated.deckId ? { currentHtml: '' } : {}),
        },
        ...(updated.result ? { result: { ...updated.result, html: '' } } : {}),
        ...(updated.status === 'succeeded' ? { assetIds: undefined } : {}),
      }
    }
    jobs.set(id, updated)
    pruneTerminalJobs()
    return structuredClone(updated)
  }

  return {
    createJob,
    getJob,
    claimQueuedJob: (id, startedAt) => update(id, { status: 'running', startedAt }, 'queued'),
    updateJob: (id, patch) => update(id, patch),
    updateJobIfStatus: (id, status, patch) => update(id, patch, status),
    async listJobsForDeck(deckId) {
      return [...jobs.values()]
        .filter((job) => job.deckId === deckId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((job) => structuredClone(job))
    },
  }
}
