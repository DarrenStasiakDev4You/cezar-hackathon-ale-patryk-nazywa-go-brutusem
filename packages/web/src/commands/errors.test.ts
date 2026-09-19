import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskContinue, TaskStop, type TaskContinueInput } from '@open-mercato/cezar-extension-api'

import { ApiError } from '@/api/client'

import { registerCoreCommands } from './core-commands'
import { apiErrorOf } from './errors'
import { CommandError, createCommandRegistry } from './registry'

afterEach(() => {
  vi.unstubAllGlobals()
})

function coreRegistry() {
  const registry = createCommandRegistry()
  registerCoreCommands(registry, { queryClient: new QueryClient() })
  return registry
}

/** What a core command rejected with. */
async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection')
    },
    (reason: unknown) => reason,
  )
}

describe('apiErrorOf', () => {
  it('returns a bare ApiError as it is', () => {
    const error = new ApiError(409, 'run is still active')

    expect(apiErrorOf(error)).toBe(error)
  })

  it('returns the ApiError a core handler failed with, from the command-failed error’s cause', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'run is still active' }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )

    const failure = await failureOf(coreRegistry().execute(TaskContinue, { taskId: 'r1' }))

    const apiError = apiErrorOf(failure)
    expect(apiError).toBeInstanceOf(ApiError)
    expect(apiError?.status).toBe(409)
    expect(apiError?.message).toBe('run is still active')
  })

  it('returns the status-0 error of an unreachable server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const failure = await failureOf(coreRegistry().execute(TaskStop, { taskId: 'r1' }))

    expect(apiErrorOf(failure)?.status).toBe(0)
  })

  it('returns undefined for invalid input — nothing was sent', async () => {
    const failure = await failureOf(
      coreRegistry().execute(TaskContinue, { taskId: 'r1', model: 1 } as unknown as TaskContinueInput),
    )

    expect(apiErrorOf(failure)).toBeUndefined()
  })

  it.each<[string, unknown]>([
    ['a timeout', new CommandError('command-timeout', 'Command "acme.slow" did not finish within 10 ms')],
    ['an extension handler’s own failure', new CommandError('command-failed', 'nope', { cause: new Error('nope') })],
    ['an ApiError-looking cause on another code', new CommandError('invalid-input', 'x', { cause: new ApiError(409, 'x') })],
    ['a plain Error', new Error('boom')],
    ['a non-error', 'run is still active'],
    ['nothing', undefined],
  ])('returns undefined for %s', (_label, error) => {
    expect(apiErrorOf(error)).toBeUndefined()
  })
})
