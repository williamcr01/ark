import { describe, expect, it } from 'vitest'

import { createJobControllerRegistry } from './controller-registry.ts'

describe('createJobControllerRegistry', () => {
  it('stores, aborts, and deletes controllers by job id', () => {
    const registry = createJobControllerRegistry()
    const controller = new AbortController()

    registry.set('job-1', controller)
    expect(registry.get('job-1')).toBe(controller)
    expect(controller.signal.aborted).toBe(false)

    registry.abort('job-1')
    expect(controller.signal.aborted).toBe(true)

    registry.delete('job-1')
    expect(registry.get('job-1')).toBeUndefined()
  })

  it('abort is a no-op when the job is not registered', () => {
    const registry = createJobControllerRegistry()
    expect(() => registry.abort('missing')).not.toThrow()
  })
})
