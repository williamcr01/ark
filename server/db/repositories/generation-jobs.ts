import { randomUUID } from 'node:crypto'

import {
  type CreateGenerationJobInput,
  type GenerationJob,
  type GenerationJobError,
  type GenerationJobObservability,
  type GenerationJobProgress,
  type GenerationJobRequest,
  type GenerationJobResult,
  type GenerationJobStatus,
  normalizeGenerationJobStatusForStorage,
  normalizeGenerationJobStatusFromStorage,
} from '../../../shared/generation-job.ts'
import { createPostgresPool, type ConnectablePool } from '../client.ts'
import { runMigrations } from '../migrate.ts'
import {
  type GenerationJobStore,
  cloneGenerationJobRequest,
  createEmptyGenerationJobProgress,
  isValidGenerationJobId,
} from '../../generation-job-record.ts'
import { DEFAULT_WORKSPACE_ID, SYSTEM_USER_ID } from './decks.ts'

type GenerationJobRow = {
  id: string
  deck_id: string | null
  workspace_id: string
  user_id: string
  chat_thread_id: string | null
  status: string
  request_metadata: Record<string, unknown> | null
  provider: string | null
  model: string | null
  error_metadata: Record<string, unknown> | null
  started_at: Date | string | null
  completed_at: Date | string | null
  result_deck_version_id: string | null
  created_at: Date | string
  updated_at: Date | string
}

type PostgresGenerationJobStoreOptions = {
  pool?: ConnectablePool
  migrate?: boolean
  now?: () => Date
  defaultOwnerUserId?: string
  defaultWorkspaceId?: string
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function readRequestMetadata(metadata: Record<string, unknown> | null): GenerationJobRequest {
  const messages = Array.isArray(metadata?.messages) ? metadata.messages : []
  const currentHtml = typeof metadata?.currentHtml === 'string' ? metadata.currentHtml : ''

  return {
    messages: messages as GenerationJobRequest['messages'],
    currentHtml,
    baseVersionId: typeof metadata?.baseVersionId === 'string' ? metadata.baseVersionId : null,
    editingExistingDeck: metadata?.editingExistingDeck === true,
  }
}

function readProgressMetadata(metadata: Record<string, unknown> | null): GenerationJobProgress {
  const progress = metadata?.progress

  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
    return createEmptyGenerationJobProgress()
  }

  const record = progress as Record<string, unknown>

  return {
    steps: Array.isArray(record.steps) ? (record.steps as GenerationJobProgress['steps']) : [],
    stepCount: typeof record.stepCount === 'number' ? record.stepCount : 0,
    assistantText: typeof record.assistantText === 'string' ? record.assistantText : null,
  }
}

function readResultMetadata(metadata: Record<string, unknown> | null): GenerationJobResult | null {
  const result = metadata?.result

  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null
  }

  const record = result as Record<string, unknown>

  if (
    typeof record.deckId !== 'string' ||
    typeof record.versionId !== 'string' ||
    typeof record.html !== 'string' ||
    typeof record.assistantText !== 'string'
  ) {
    return null
  }

  return {
    deckId: record.deckId,
    versionId: record.versionId,
    html: record.html,
    validation: record.validation ?? null,
    assistantText: record.assistantText,
  }
}

function readErrorMetadata(metadata: Record<string, unknown> | null): GenerationJobError | null {
  if (!metadata || typeof metadata.message !== 'string') {
    return null
  }

  return {
    message: metadata.message,
    code: typeof metadata.code === 'string' ? metadata.code : null,
    validation: metadata.validation,
    errorCategory: typeof metadata.errorCategory === 'string' ? metadata.errorCategory : null,
  }
}

function readObservabilityMetadata(
  metadata: Record<string, unknown> | null,
): GenerationJobObservability | null {
  const observability = metadata?.observability

  if (!observability || typeof observability !== 'object' || Array.isArray(observability)) {
    return null
  }

  return observability as GenerationJobObservability
}

function rowToJob(row: GenerationJobRow): GenerationJob {
  const requestMetadata = row.request_metadata ?? {}
  const errorMetadata = row.error_metadata ?? {}

  return {
    id: row.id,
    deckId: row.deck_id,
    baseVersionId:
      typeof requestMetadata.baseVersionId === 'string' ? requestMetadata.baseVersionId : null,
    chatThreadId: row.chat_thread_id,
    status: normalizeGenerationJobStatusFromStorage(row.status),
    model: row.model ?? '',
    provider: row.provider,
    request: readRequestMetadata(requestMetadata),
    progress: readProgressMetadata(requestMetadata),
    result: readResultMetadata(requestMetadata),
    error: readErrorMetadata(errorMetadata),
    observability: readObservabilityMetadata(requestMetadata),
    retryOfJobId:
      typeof requestMetadata.retryOfJobId === 'string' ? requestMetadata.retryOfJobId : null,
    assetIds: Array.isArray(requestMetadata.assetIds)
      ? requestMetadata.assetIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    startedAt: row.started_at ? toIsoString(row.started_at) : null,
    completedAt: row.completed_at ? toIsoString(row.completed_at) : null,
  }
}

export function createPostgresGenerationJobStore(
  options: PostgresGenerationJobStoreOptions = {},
): GenerationJobStore {
  const pool = options.pool ?? createPostgresPool()
  const now = options.now ?? (() => new Date())
  const defaultOwnerUserId = options.defaultOwnerUserId ?? SYSTEM_USER_ID
  const defaultWorkspaceId = options.defaultWorkspaceId ?? DEFAULT_WORKSPACE_ID
  let migrated = false

  const ensureMigrated = async () => {
    if (migrated || options.migrate === false) {
      return
    }

    await runMigrations(pool)
    migrated = true
  }

  const createJob = async (input: CreateGenerationJobInput) => {
    await ensureMigrated()

    const id = randomUUID()
    const timestamp = now()
    const request = cloneGenerationJobRequest(input.request)
    const requestMetadata = {
      messages: request.messages,
      currentHtml: request.currentHtml,
      baseVersionId: input.baseVersionId ?? request.baseVersionId ?? null,
      editingExistingDeck: request.editingExistingDeck ?? false,
      retryOfJobId: input.retryOfJobId ?? null,
      assetIds: input.assetIds ?? [],
      progress: createEmptyGenerationJobProgress(),
    }

    await pool.query(
      `
        INSERT INTO generation_jobs (
          id,
          deck_id,
          workspace_id,
          user_id,
          chat_thread_id,
          status,
          request_metadata,
          provider,
          model,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $10)
      `,
      [
        id,
        input.deckId ?? null,
        defaultWorkspaceId,
        defaultOwnerUserId,
        input.chatThreadId ?? null,
        'queued',
        JSON.stringify(requestMetadata),
        input.provider ?? null,
        input.model,
        timestamp,
      ],
    )

    const job = await getJob(id)
    if (!job) {
      throw new Error('Failed to create generation job.')
    }

    return job
  }

  const getJob = async (id: string) => {
    if (!isValidGenerationJobId(id)) {
      return null
    }

    await ensureMigrated()

    const result = await pool.query<GenerationJobRow>(
      `
        SELECT
          id,
          deck_id,
          workspace_id,
          user_id,
          chat_thread_id,
          status,
          request_metadata,
          provider,
          model,
          error_metadata,
          started_at,
          completed_at,
          result_deck_version_id,
          created_at,
          updated_at
        FROM generation_jobs
        WHERE id = $1
      `,
      [id],
    )

    const row = result.rows[0]
    return row ? rowToJob(row) : null
  }

  const updateJobIfStatus = async (
    id: string,
    expectedStatus: GenerationJobStatus,
    patch: Partial<{
      status: GenerationJobStatus
      deckId: string | null
      progress: GenerationJobProgress
      result: GenerationJobResult | null
      error: GenerationJobError | null
      observability: GenerationJobObservability | null
      startedAt: string | null
      completedAt: string | null
    }>,
  ) => {
    if (!isValidGenerationJobId(id)) {
      return null
    }

    await ensureMigrated()

    const existing = await getJob(id)

    if (!existing || existing.status !== expectedStatus) {
      return null
    }

    const timestamp = now()
    const requestMetadata = {
      messages: existing.request.messages,
      currentHtml: existing.request.currentHtml,
      baseVersionId: existing.baseVersionId,
      editingExistingDeck: existing.request.editingExistingDeck ?? false,
      retryOfJobId: existing.retryOfJobId,
      progress: patch.progress ?? existing.progress,
      result: patch.result === undefined ? existing.result : patch.result,
      observability:
        patch.observability === undefined ? existing.observability : patch.observability,
    }
    const errorMetadata =
      patch.error === undefined
        ? existing.error
        : patch.error
          ? {
              message: patch.error.message,
              code: patch.error.code ?? null,
              validation: patch.error.validation ?? null,
              errorCategory: patch.error.errorCategory ?? null,
            }
          : null

    const result = await pool.query<GenerationJobRow>(
      `
        UPDATE generation_jobs
        SET
          deck_id = COALESCE($2, deck_id),
          status = COALESCE($3, status),
          request_metadata = $4::jsonb,
          error_metadata = COALESCE($5::jsonb, '{}'::jsonb),
          started_at = COALESCE($6, started_at),
          completed_at = COALESCE($7, completed_at),
          result_deck_version_id = COALESCE($8, result_deck_version_id),
          updated_at = $9
        WHERE id = $1
          AND status = $10
        RETURNING
          id,
          deck_id,
          workspace_id,
          user_id,
          chat_thread_id,
          status,
          request_metadata,
          provider,
          model,
          error_metadata,
          started_at,
          completed_at,
          result_deck_version_id,
          created_at,
          updated_at
      `,
      [
        id,
        patch.deckId ?? null,
        patch.status ? normalizeGenerationJobStatusForStorage(patch.status) : null,
        JSON.stringify(requestMetadata),
        errorMetadata ? JSON.stringify(errorMetadata) : null,
        patch.startedAt ? new Date(patch.startedAt) : null,
        patch.completedAt ? new Date(patch.completedAt) : null,
        patch.result?.versionId ?? null,
        timestamp,
        normalizeGenerationJobStatusForStorage(expectedStatus),
      ],
    )

    const row = result.rows[0]
    return row ? rowToJob(row) : null
  }

  const claimQueuedJob = async (id: string, startedAt: string) =>
    updateJobIfStatus(id, 'queued', {
      status: 'running',
      startedAt,
    })

  const updateJob = async (
    id: string,
    patch: Partial<{
      status: GenerationJobStatus
      deckId: string | null
      progress: GenerationJobProgress
      result: GenerationJobResult | null
      error: GenerationJobError | null
      observability: GenerationJobObservability | null
      startedAt: string | null
      completedAt: string | null
    }>,
  ) => {
    if (!isValidGenerationJobId(id)) {
      return null
    }

    await ensureMigrated()

    const existing = await getJob(id)

    if (!existing) {
      return null
    }

    const timestamp = now()
    const requestMetadata = {
      messages: existing.request.messages,
      currentHtml: existing.request.currentHtml,
      baseVersionId: existing.baseVersionId,
      editingExistingDeck: existing.request.editingExistingDeck ?? false,
      retryOfJobId: existing.retryOfJobId,
      progress: patch.progress ?? existing.progress,
      result: patch.result === undefined ? existing.result : patch.result,
      observability:
        patch.observability === undefined ? existing.observability : patch.observability,
    }
    const errorMetadata =
      patch.error === undefined
        ? existing.error
        : patch.error
          ? {
              message: patch.error.message,
              code: patch.error.code ?? null,
              validation: patch.error.validation ?? null,
              errorCategory: patch.error.errorCategory ?? null,
            }
          : null

    const result = await pool.query<GenerationJobRow>(
      `
        UPDATE generation_jobs
        SET
          deck_id = COALESCE($2, deck_id),
          status = COALESCE($3, status),
          request_metadata = $4::jsonb,
          error_metadata = COALESCE($5::jsonb, '{}'::jsonb),
          started_at = COALESCE($6, started_at),
          completed_at = COALESCE($7, completed_at),
          result_deck_version_id = COALESCE($8, result_deck_version_id),
          updated_at = $9
        WHERE id = $1
        RETURNING
          id,
          deck_id,
          workspace_id,
          user_id,
          chat_thread_id,
          status,
          request_metadata,
          provider,
          model,
          error_metadata,
          started_at,
          completed_at,
          result_deck_version_id,
          created_at,
          updated_at
      `,
      [
        id,
        patch.deckId ?? null,
        patch.status ? normalizeGenerationJobStatusForStorage(patch.status) : null,
        JSON.stringify(requestMetadata),
        errorMetadata ? JSON.stringify(errorMetadata) : null,
        patch.startedAt ? new Date(patch.startedAt) : null,
        patch.completedAt ? new Date(patch.completedAt) : null,
        patch.result?.versionId ?? null,
        timestamp,
      ],
    )

    const row = result.rows[0]
    return row ? rowToJob(row) : null
  }

  const listJobsForDeck = async (deckId: string) => {
    await ensureMigrated()

    const result = await pool.query<GenerationJobRow>(
      `
        SELECT
          id,
          deck_id,
          workspace_id,
          user_id,
          chat_thread_id,
          status,
          request_metadata,
          provider,
          model,
          error_metadata,
          started_at,
          completed_at,
          result_deck_version_id,
          created_at,
          updated_at
        FROM generation_jobs
        WHERE deck_id = $1
        ORDER BY created_at DESC
      `,
      [deckId],
    )

    return result.rows.map(rowToJob)
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
