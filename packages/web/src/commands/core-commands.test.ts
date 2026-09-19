import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import type { AttachmentInput } from '@open-mercato/cezar-api-client'
import {
  TaskArchive,
  TaskContinue,
  TaskStop,
  isExtensionError,
  type TaskArchiveInput,
  type TaskAttachment,
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

  const attachment = { mediaType: 'image/png', data: 'iVBORw0KGgo=', name: 'shot.png' }
  const full = {
    runner: 'codex',
    model: 'gpt-5.1-codex',
    agentProfile: 'work',
    text: 'Fix the failing test.',
    attachments: [attachment],
  } satisfies Omit<TaskContinueInput, 'taskId'>
  const fullBody = {
    text: 'Fix the failing test.',
    images: [attachment],
    runner: 'codex',
    model: 'gpt-5.1-codex',
    agentProfile: 'work',
  }

  it('sends the composer’s whole request — prompt, files, runner, model and account', async () => {
    const sent = stubFetch()
    const { registry } = setup()

    await registry.execute(TaskContinue, { taskId: 'r1', ...full })
    await registry.execute(TaskContinue, { taskId: 'r1', projectId: 'web', ...full })

    expect(sent).toEqual([
      { path: '/api/v1/runs/r1/continue', method: 'POST', body: fullBody },
      { path: '/api/v1/p/web/runs/r1/continue', method: 'POST', body: fullBody },
    ])
  })

  it('omits a blank prompt and an empty file list, and keeps the "auto" model', async () => {
    const sent = stubFetch()
    const { registry } = setup()

    await registry.execute(TaskContinue, { taskId: 'r1', text: '  \n ', attachments: [], model: '' })

    expect(sent).toEqual([{ path: '/api/v1/runs/r1/continue', method: 'POST', body: { model: '' } }])
  })

  it('sends a file with no name without one', async () => {
    const sent = stubFetch()
    const { registry } = setup()

    await registry.execute(TaskContinue, {
      taskId: 'r1',
      attachments: [{ mediaType: 'application/pdf', data: 'JVBERi0=' }],
    })

    expect(sent[0]?.body).toEqual({ images: [{ mediaType: 'application/pdf', data: 'JVBERi0=' }] })
  })

  it('ignores unknown keys', async () => {
    const sent = stubFetch()
    const { registry } = setup()

    await registry.execute(TaskContinue, { taskId: 'r1', text: 'Go on.', temperature: 0.2 } as TaskContinueInput)

    expect(sent[0]?.body).toEqual({ text: 'Go on.' })
  })

  it('mirrors the contract’s attachment shape in both directions', () => {
    expectTypeOf<TaskAttachment>().toExtend<AttachmentInput>()
    expectTypeOf<AttachmentInput>().toExtend<TaskAttachment>()
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

  const secret = 'do-not-echo-this-value'
  const file = (overrides: Record<string, unknown>) => ({ mediaType: 'image/png', data: 'iVBORw0KGgo=', ...overrides })

  it.each<[string, Record<string, unknown>, string]>([
    ['a numeric model', { model: 1 }, 'model must be a string of at most 200 characters when present'],
    ['a 201-character model', { model: `${secret}${'m'.repeat(201)}` }, 'model must be a string of at most 200 characters when present'],
    ['an over-long account', { agentProfile: `${secret}${'a'.repeat(64)}` }, 'agentProfile must be a string of at most 64 characters when present'],
    ['a non-string prompt', { text: { secret } }, 'text must be a string of at most 100000 characters when present'],
    ['an over-long prompt', { text: `${secret}${'t'.repeat(100_000)}` }, 'text must be a string of at most 100000 characters when present'],
    ['attachments that are not a list', { attachments: secret }, 'attachments must be a list of at most 4 files when present'],
    ['five attachments', { attachments: [file({}), file({}), file({}), file({}), file({})] }, 'attachments must be a list of at most 4 files when present'],
    [
      'an unsupported media type',
      { attachments: [file({}), file({ mediaType: `application/${secret}` })] },
      'attachments[1] must be an image, text, markdown or PDF file with 1 to 7,000,000 characters of data and a name of at most 255 characters',
    ],
    [
      'an empty payload',
      { attachments: [file({ data: '' })] },
      'attachments[0] must be an image, text, markdown or PDF file with 1 to 7,000,000 characters of data and a name of at most 255 characters',
    ],
    [
      'an over-long file name',
      { attachments: [file({ name: `${secret}${'n'.repeat(255)}` })] },
      'attachments[0] must be an image, text, markdown or PDF file with 1 to 7,000,000 characters of data and a name of at most 255 characters',
    ],
  ])('refuses %s for continue, naming the field and not the value', async (_label, fields, rule) => {
    const sent = stubFetch()
    const { registry } = setup()

    const error = await rejection(registry.execute(TaskContinue, { taskId: 'r1', ...fields } as TaskContinueInput))

    expect(error.code).toBe('invalid-input')
    expect(error.message).toBe(`Invalid input for cezar.task.continue: ${rule}`)
    expect(error.message).not.toContain(secret)
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

  it('back-to-back 409s join one refetch rather than cancelling and restarting it', async () => {
    stubFetch(() => jsonResponse({ error: 'run is still active' }, 409))
    const queryClient = new QueryClient()
    const registry = createCommandRegistry()
    registerCoreCommands(registry, { queryClient })
    // An observed runs list whose answers the test releases by hand, as a mounted view would have.
    const pending: Array<() => void> = []
    const queryFn = vi.fn(() => new Promise<string[]>((resolve) => pending.push(() => resolve([]))))
    const unsubscribe = new QueryObserver(queryClient, { queryKey: ['default', 'runs', 'list'], queryFn }).subscribe(
      () => {},
    )
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
    pending.shift()?.()
    await vi.waitFor(() => expect(queryClient.getQueryState(['default', 'runs', 'list'])?.status).toBe('success'))

    // The idle-teardown retry: the same refusal, again and again, while the refetch is in flight.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await rejection(registry.execute(TaskContinue, { taskId: 'r1' }))
    }

    expect(queryFn).toHaveBeenCalledTimes(2)
    pending.shift()?.()
    unsubscribe()
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

describe('when a command resolves', () => {
  /** A client whose invalidations never finish refetching. */
  function stalledSetup() {
    const queryClient = new QueryClient()
    vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(new Promise<void>(() => {}))
    const registry = createCommandRegistry()
    registerCoreCommands(registry, { queryClient })
    return registry
  }

  /** Whether `promise` settles within a few macrotasks. */
  async function settlesSoon(promise: Promise<unknown>): Promise<boolean> {
    let settled = false
    void promise.then(
      () => (settled = true),
      () => (settled = true),
    )
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    return settled
  }

  it('continue resolves once the service accepts, without waiting for the refetch', async () => {
    stubFetch()
    const registry = stalledSetup()

    expect(await settlesSoon(registry.execute(TaskContinue, { taskId: 'r1' }))).toBe(true)
    expect(
      await settlesSoon(
        registry.execute(TaskContinue, {
          taskId: 'r1',
          projectId: 'web',
          runner: 'codex',
          model: '',
          agentProfile: 'work',
          text: 'Go on.',
          attachments: [{ mediaType: 'text/plain', data: 'aGk=' }],
        }),
      ),
    ).toBe(true)
  })

  it('stop and archive resolve only after the refetch, so their results arrive with fresh caches', async () => {
    stubFetch(() => jsonResponse({ id: 'r1', archived: true, cancelled: true }))
    const registry = stalledSetup()

    expect(await settlesSoon(registry.execute(TaskStop, { taskId: 'r1' }))).toBe(false)
    expect(await settlesSoon(registry.execute(TaskArchive, { taskId: 'r1' }))).toBe(false)
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

  it('passes its options to every invalidation, and none when it has none', async () => {
    const queryClient = new QueryClient()
    const invalidated = vi.spyOn(queryClient, 'invalidateQueries')

    await invalidateTaskKeys(queryClient, 'web', { cancelRefetch: false })
    await invalidateTaskKeys(queryClient)

    expect(invalidated.mock.calls).toEqual([
      [{ queryKey: ['workspace', 'runs-index'] }, { cancelRefetch: false }],
      [{ queryKey: ['default', 'runs'] }, { cancelRefetch: false }],
      [{ queryKey: ['web', 'runs', 'list'] }, { cancelRefetch: false }],
      [{ queryKey: ['default', 'runs'] }],
    ])
  })
})
