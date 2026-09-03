export type JobControllerRegistry = {
  set: (jobId: string, controller: AbortController) => void
  get: (jobId: string) => AbortController | undefined
  delete: (jobId: string) => void
  abort: (jobId: string) => void
}

export function createJobControllerRegistry(
  controllers: Map<string, AbortController> = new Map(),
): JobControllerRegistry {
  return {
    set(jobId, controller) {
      controllers.set(jobId, controller)
    },
    get(jobId) {
      return controllers.get(jobId)
    },
    delete(jobId) {
      controllers.delete(jobId)
    },
    abort(jobId) {
      controllers.get(jobId)?.abort()
    },
  }
}
