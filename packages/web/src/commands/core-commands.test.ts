import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  TaskArchive,
  TaskContinue,
  TaskStop,
  isExtensionError,
  type TaskArchiveInput,
  type TaskContinueInput,
} from '@open-mercato/cezar-extension-api'

import { fixtureManifest } from '../extensions/registry.fixtures'
import { invalidateTaskKeys, registerCoreCommands } from './core-commands'
import { createCommandRegistry } from './registry'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

interface SentRequest {
  readonly path: string
  readonly method: string
  readonly body: unknown
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Stubs fetch and records every request — the same seam `run-header.test.tsx` asserts on. */
function stubFetch(answer: (path: string) => Response = () => jsonResponse({})): SentRequest[] {
  const sent: SentRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = String(input)
      sent.push({
        path,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      })
      return answer(path)
    }),
  )
  return sent
}

function setup() {
  const queryClient = new QueryClient()
  const invalidated = vi.spyOn(queryClient, 'invalidateQueries')
  const registry = createCommandRegistry()
  const registration = registerCoreCommands(registry, { queryClient })
  const keys = () => invalidated.mock.calls.map(([filters]) => filters?.queryKey)
  return { registry, registration, keys }
}

async function rejection(promise: Promise<unknown>): Promise<Error & { code: string }> {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection')
    },
    (reason: unknown) => reason,
  )
  expect(isExtensionError(error)).toBe(true)
  return error as Error & { code: string }
}

describe('cezar.task.continue', () => {
  it('sends the request the run header sends, and answers { taskId, continued }', async () => {
    const sent = stubFetch()
    const { registry, keys } = setup()

    await expect(registry.execute(TaskContinue, { taskId: 'r1' })).resolves.toEqual({ taskId: 'r1', continued: true })

    expect(sent).toEqual([{ path: '/api/v1/runs/r1/continue', method: 'POST', body: {} }])
    expect(keys()).toEqual([['default', 'runs']])
  })

  it('passes a runner override, and addresses an explicit project', async () => {
    const sent = stubFetch()
    const { registry, keys } = setup()

    await registry.execute(TaskContinue, { taskId: 'r1', projectId: 'web', runner: 'codex' })

    expect(sent).toEqual([{ path: '/api/v1/p/web/runs/r1/continue', method: 'POST', body: { runner: 'codex' } }])
    expect(keys()).toEqual([['workspace', 'runs-index'], ['default', 'runs'], ['web', 'runs', 'list']])
  })
})

describe('cezar.task.stop', () => {
  it('cancels, scoped or explicit, and reports what the service said', async () => {
    const sent = stubFetch(() => jsonResponse({ cancelled: true }))
    const { registry } = setup()

    await expect(registry.execute(TaskStop, { taskId: 'r1' })).resolves.toEqual({ taskId: 'r1', stopped: true })
    await expect(registry.execute(TaskStop, { taskId: 'r1', projectId: 'api' })).resolves.toEqual({
      taskId: 'r1',
      stopped: true,
    })

    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /api/v1/runs/r1/cancel',
      'POST /api/v1/p/api/runs/r1/cancel',
    ])
  })

  it('answers stopped: false when there was nothing to stop', async () => {
    stubFetch(() => jsonResponse({ cancelled: false }))
    const { registry } = setup()

    await expect(registry.execute(TaskStop, { taskId: 'r1' })).resolves.toEqual({ taskId: 'r1', stopped: false })
  })
})

describe('cezar.task.archive', () => {
  it('archives by default and restores with archived: false, returning the record’s state', async () => {
    const sent = stubFetch()
    let archived = true
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      sent.push({ path: String(input), method: init?.method ?? 'GET', body: JSON.parse(String(init?.body)) })
      return jsonResponse({ id: 'r1', archived })
    })
    const { registry, keys } = setup()

    await expect(registry.execute(TaskArchive, { taskId: 'r1' })).resolves.toEqual({ taskId: 'r1', archived: true })
    archived = false
    await expect(registry.execute(TaskArchive, { taskId: 'r1', projectId: 'api', archived: false })).resolves.toEqual({
      taskId: 'r1',
      archived: false,
    })

    expect(sent).toEqual([
      { path: '/api/v1/runs/r1/archive', method: 'POST', body: { archived: true } },
      { path: '/api/v1/p/api/runs/r1/archive', method: 'POST', body: { archived: false } },
    ])
    expect(keys()).toEqual([
      ['default', 'runs'],
      ['workspace', 'runs-index'],
      ['default', 'runs'],
      ['api', 'runs', 'list'],
    ])
  })
})

describe('input validation', () => {
  it.each<[string, unknown[], string]>([
    ['no input', [], 'expected exactly one input object'],
    ['two inputs', [{ taskId: 'r1' }, { taskId: 'r2' }], 'expected exactly one input object'],
    ['a string input', ['r1'], 'expected exactly one input object'],
    ['a missing taskId', [{}], 'taskId must be a non-empty string'],
    ['an empty taskId', [{ taskId: '' }], 'taskId must be a non-empty string'],
    ['a numeric projectId', [{ taskId: 'r1', projectId: 7 }], 'projectId must be a non-empty string when present'],
    [
      'an unknown runner',
      [{ taskId: 'r1', runner: 'gpt-9000' }],
      'runner must be one of claude, codex, opencode, pi when present',
    ],
  ])('refuses %s for continue — invalid-input, nothing sent', async (_label, args, rule) => {
    const sent = stubFetch()
    const { registry } = setup()

    const error = await rejection(
      registry.execute(TaskContinue, ...(args as unknown as [input: TaskContinueInput])),
    )

    expect(error.code).toBe('invalid-input')
    expect(error.message).toBe(`Invalid input for cezar.task.continue: ${rule}`)
    expect(sent).toEqual([])
  })

  it('refuses a non-boolean archived flag, naming the rule and not the value', async () => {
    const sent = stubFetch()
    const { registry } = setup()

    const error = await rejection(
      registry.execute(TaskArchive, { taskId: 'r1', archived: 'yes' } as unknown as TaskArchiveInput),
    )

    expect(error.code).toBe('invalid-input')
    expect(error.message).toBe('Invalid input for cezar.task.archive: archived must be a boolean when present')
    expect(error.message).not.toContain('yes')
    expect(sent).toEqual([])
  })

  it('ignores unknown keys, so a caller built against a later input shape still runs', async () => {
    const sent = stubFetch()
    const { registry } = setup()

    await registry.execute(TaskStop, { taskId: 'r1', reason: 'later field' } as never)

    expect(sent.map(({ path }) => path)).toEqual(['/api/v1/runs/r1/cancel'])
  })
})

describe('failures', () => {
  it('a 409 invalidates the task caches and rejects command-failed with the server’s words', async () => {
    stubFetch(() => jsonResponse({ error: 'run is still active' }, 409))
    const { registry, keys } = setup()

    const error = await rejection(registry.execute(TaskContinue, { taskId: 'r1' }))

    expect(error.code).toBe('command-failed')
    expect(error.message).toBe('run is still active')
    expect((error.cause as { status?: number }).status).toBe(409)
    expect(keys()).toEqual([['default', 'runs']])
  })

  it('another refusal rejects command-failed and invalidates nothing', async () => {
    stubFetch(() => jsonResponse({ error: 'no such run' }, 404))
    const { registry, keys } = setup()

    const error = await rejection(registry.execute(TaskArchive, { taskId: 'r1' }))

    expect(error.code).toBe('command-failed')
    expect(error.message).toBe('no such run')
    expect(keys()).toEqual([])
  })

  it('an unreachable server rejects command-failed and invalidates nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const { registry, keys } = setup()

    const error = await rejection(registry.execute(TaskStop, { taskId: 'r1' }))

    expect(error.code).toBe('command-failed')
    expect(error.message).toContain('cannot reach the cezar server')
    expect(keys()).toEqual([])
  })
})

describe('registerCoreCommands', () => {
  it('registers all three as public, and removes all three with one Disposable', () => {
    stubFetch()
    const { registry, registration } = setup()
    const extension = registry.forExtension({
      extension: fixtureManifest('acme.alpha'),
      track: (disposable) => disposable,
      assertLive: () => {},
    })

    const ids = [TaskContinue.id, TaskStop.id, TaskArchive.id]
    expect(ids.map((id) => extension.has(id))).toEqual([true, true, true])

    registration.dispose()

    expect(ids.map((id) => registry.has(id))).toEqual([false, false, false])
  })
})

describe('invalidateTaskKeys', () => {
  it('resolves once every invalidation has', async () => {
    const queryClient = new QueryClient()
    const invalidated = vi.spyOn(queryClient, 'invalidateQueries')

    await expect(invalidateTaskKeys(queryClient, 'web')).resolves.toBeUndefined()
    await expect(invalidateTaskKeys(queryClient)).resolves.toBeUndefined()

    expect(invalidated).toHaveBeenCalledTimes(4)
  })
})
