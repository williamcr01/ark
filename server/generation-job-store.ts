import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { createPostgresGenerationJobStore } from './db/repositories/generation-jobs.ts'
import {
  type CreateGenerationJobInput,
  type GenerationJob,
  type GenerationJobError,
  type GenerationJobProgress,
  type GenerationJobResult,
  type GenerationJobStatus,
  isGenerationJobStatus,
} from '../shared/generation-job.ts'
import {
  type GenerationJobStore,
  cloneGenerationJobRequest,
  createEmptyGenerationJobProgress,
  isValidGenerationJobId,
} from './generation-job-record.ts'

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data', 'generation-jobs')

type StoredGenerationJobFile = GenerationJob

function resolveJobPath(dataDir: string, id: string) {
  if (!isValidGenerationJobId(id)) {
    return null
  }

  const resolvedDataDir = path.resolve(dataDir)
  const resolvedPath = path.resolve(resolvedDataDir, `${id}.json`)
  const dataDirPrefix = resolvedDataDir.endsWith(path.sep)
    ? resolvedDataDir
    : `${resolvedDataDir}${path.sep}`

  if (!resolvedPath.startsWith(dataDirPrefix)) {
    return null
  }

  return resolvedPath
}

async function ensureDataDir(dataDir: string) {
  await mkdir(dataDir, { recursive: true })
}

function parseStoredJob(parsed: unknown): StoredGenerationJobFile | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }

  const record = parsed as Partial<StoredGenerationJobFile>

  if (
    typeof record.id !== 'string' ||
    !isValidGenerationJobId(record.id) ||
    !isGenerationJobStatus(record.status) ||
    typeof record.model !== 'string' ||
    !record.request ||
    typeof record.request !== 'object' ||
    !Array.isArray(record.request.messages) ||
    typeof record.request.currentHtml !== 'string' ||
    !record.progress ||
    typeof record.progress !== 'object' ||
    !Array.isArray(record.progress.steps) ||
    typeof record.progress.stepCount !== 'number' ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string'
  ) {
    return null
  }

  return {
    id: record.id,
    deckId: typeof record.deckId === 'string' ? record.deckId : null,
    baseVersionId: typeof record.baseVersionId === 'string' ? record.baseVersionId : null,
    chatThreadId: typeof record.chatThreadId === 'string' ? record.chatThreadId : null,
    status: record.status,
    model: record.model,
    provider: typeof record.provider === 'string' ? record.provider : null,
    request: {
      messages: record.request.messages,
      currentHtml: record.request.currentHtml,
      baseVersionId:
        typeof record.request.baseVersionId === 'string' ? record.request.baseVersionId : null,
      editingExistingDeck: record.request.editingExistingDeck === true,
    },
    progress: {
      steps: record.progress.steps,
      stepCount: record.progress.stepCount,
      assistantText:
        typeof record.progress.assistantText === 'string' ? record.progress.assistantText : null,
    },
    result: record.result ?? null,
    error: record.error ?? null,
    retryOfJobId: typeof record.retryOfJobId === 'string' ? record.retryOfJobId : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    startedAt: typeof record.startedAt === 'string' ? record.startedAt : null,
    completedAt: typeof record.completedAt === 'string' ? record.completedAt : null,
  }
}

async function readJobFile(filePath: string) {
  try {
    const raw = await readFile(filePath, 'utf8')
    return parseStoredJob(JSON.parse(raw))
  } catch {
    return null
  }
}

async function writeJobFile(filePath: string, job: StoredGenerationJobFile) {
  const tempPath = `${filePath}.${randomUUID()}.tmp`
  await writeFile(tempPath, JSON.stringify(job, null, 2), 'utf8')
  await rename(tempPath, filePath)
}

const jobLocks = new Map<string, Promise<void>>()

async function withJobLock<T>(jobId: string, operation: () => Promise<T>) {
  const previous = jobLocks.get(jobId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const current = previous.then(() => gate)
  jobLocks.set(jobId, current)

  await previous

  try {
    return await operation()
  } finally {
    release()
    if (jobLocks.get(jobId) === current) {
      jobLocks.delete(jobId)
    }
  }
}

export function createGenerationJobStore(dataDir = DEFAULT_DATA_DIR): GenerationJobStore {
  const createJob = async (input: CreateGenerationJobInput) => {
    await ensureDataDir(dataDir)

    const now = new Date().toISOString()
    const job: StoredGenerationJobFile = {
      id: randomUUID(),
      deckId: input.deckId ?? null,
      baseVersionId: input.baseVersionId ?? input.request.baseVersionId ?? null,
      chatThreadId: input.chatThreadId ?? null,
      status: 'queued',
      model: input.model,
      provider: input.provider ?? null,
      request: cloneGenerationJobRequest(input.request),
      progress: createEmptyGenerationJobProgress(),
      result: null,
      error: null,
      retryOfJobId: input.retryOfJobId ?? null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    }

    const filePath = resolveJobPath(dataDir, job.id)

    if (!filePath) {
      throw new Error('Could not resolve generation job path.')
    }

    await writeJobFile(filePath, job)
    return job
  }

  const getJob = async (id: string) => {
    const filePath = resolveJobPath(dataDir, id)

    if (!filePath) {
      return null
    }

    return readJobFile(filePath)
  }

  const updateJob = async (
    id: string,
    patch: Partial<{
      status: GenerationJobStatus
      deckId: string | null
      progress: GenerationJobProgress
      result: GenerationJobResult | null
      error: GenerationJobError | null
      startedAt: string | null
      completedAt: string | null
    }>,
  ) =>
    withJobLock(id, async () => {
      const filePath = resolveJobPath(dataDir, id)

      if (!filePath) {
        return null
      }

      const existing = await readJobFile(filePath)

      if (!existing) {
        return null
      }

      const updated: StoredGenerationJobFile = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      }

      await writeJobFile(filePath, updated)
      return updated
    })

  const updateJobIfStatus = async (
    id: string,
    expectedStatus: GenerationJobStatus,
    patch: Partial<{
      status: GenerationJobStatus
      deckId: string | null
      progress: GenerationJobProgress
      result: GenerationJobResult | null
      error: GenerationJobError | null
      startedAt: string | null
      completedAt: string | null
    }>,
  ) =>
    withJobLock(id, async () => {
      const filePath = resolveJobPath(dataDir, id)

      if (!filePath) {
        return null
      }

      const existing = await readJobFile(filePath)

      if (!existing || existing.status !== expectedStatus) {
        return null
      }

      const updated: StoredGenerationJobFile = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      }

      await writeJobFile(filePath, updated)
      return updated
    })

  const claimQueuedJob = async (id: string, startedAt: string) =>
    updateJobIfStatus(id, 'queued', {
      status: 'running',
      startedAt,
    })

  const listJobsForDeck = async (deckId: string) => {
    await ensureDataDir(dataDir)

    const entries = await readdir(dataDir, { withFileTypes: true })
    const jobs: GenerationJob[] = []

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue
      }

      const job = await readJobFile(path.join(dataDir, entry.name))

      if (job?.deckId === deckId) {
        jobs.push(job)
      }
    }

    return jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  return {
    createJob,
    getJob,
    claimQueuedJob,
    updateJob,
    updateJobIfStatus,
    listJobsForDeck,
  }
}

export function createDefaultGenerationJobStore(env = process.env): GenerationJobStore {
  if (env.DATABASE_URL?.trim()) {
    return createPostgresGenerationJobStore()
  }

  return createGenerationJobStore()
}

export const generationJobStore = createDefaultGenerationJobStore()
