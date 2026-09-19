import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  defineEvent,
  defineExtension,
  isExtensionError,
  type Disposable,
  type Extension,
  type ExtensionContext,
  type ExtensionManifest,
} from '@open-mercato/cezar-extension-api'
import {
  deferred,
  disposable,
  fixture,
  fixtureManifest,
  pingCommand,
  recordingServices,
} from './registry.fixtures'
import {
  createExtensionRegistry,
  ExtensionRegistryError,
  type ExtensionErrorReport,
  type ExtensionRegistryOptions,
} from './registry'

afterEach(() => {
  vi.useRealTimers()
})

const noServices: ExtensionRegistryOptions['services'] = () => {
  throw new Error('no services in this test')
}

function registryError(run: () => unknown): ExtensionRegistryError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(ExtensionRegistryError)
    return error as ExtensionRegistryError
  }
  throw new Error('expected an ExtensionRegistryError')
}

describe('register', () => {
  it('records a valid extension as registered, and `{ enabled: false }` as disabled', () => {
    const registry = createExtensionRegistry({ services: noServices })

    const enabled = registry.register(fixture('acme.alpha'))
    const disabled = registry.register(fixture('acme.beta'), { enabled: false })

    expect(enabled).toEqual({ id: 'acme.alpha', manifest: fixtureManifest('acme.alpha'), status: 'registered' })
    expect(disabled.status).toBe('disabled')
    expect(enabled).not.toHaveProperty('error')
    expect(registry.get('acme.alpha')).toBe(enabled)
    expect(registry.get('acme.beta')).toBe(disabled)
    expect(registry.get('acme.nobody')).toBeUndefined()
  })

  it('refuses a duplicate id and leaves the first record untouched', () => {
    const registry = createExtensionRegistry({ services: noServices })
    const first = registry.register(fixture('acme.alpha'))

    const error = registryError(() => registry.register(fixture('acme.alpha')))

    expect(error.code).toBe('duplicate-extension')
    expect(error.name).toBe('ExtensionRegistryError')
    expect(error.message).toContain('acme.alpha')
    expect(registry.get('acme.alpha')).toBe(first)
    expect(registry.list()).toEqual([first])
  })

  it('refuses an invalid manifest with every issue from defineExtension', () => {
    const registry = createExtensionRegistry({ services: noServices })
    const broken = {
      manifest: { id: 'Not An Id', name: '', version: 'one', engines: { cezar: '^0.11.0' } },
      activate() {},
    } as unknown as Extension

    const error = registryError(() => registry.register(broken))

    expect(error.code).toBe('invalid-extension')
    expect(error.issues.map((issue) => issue.path)).toEqual(['manifest.id', 'manifest.name', 'manifest.version'])
    expect(registry.list()).toEqual([])
  })

  it('refuses an extension without `activate`', () => {
    const registry = createExtensionRegistry({ services: noServices })
    const noActivate = { manifest: fixtureManifest('acme.alpha') } as unknown as Extension

    const error = registryError(() => registry.register(noActivate))

    expect(error.code).toBe('invalid-extension')
    expect(error.issues).toEqual([{ path: 'activate', message: 'must be a function' }])
  })

  it('refuses a value that is not an extension object at all', () => {
    const registry = createExtensionRegistry({ services: noServices })

    const error = registryError(() => registry.register(null as unknown as Extension))

    expect(error.code).toBe('invalid-extension')
    expect(error.issues).toHaveLength(1)
  })

  it('keeps registration order and returns frozen records', () => {
    const registry = createExtensionRegistry({ services: noServices })
    for (const id of ['acme.charlie', 'acme.alpha', 'acme.bravo']) registry.register(fixture(id))

    const records = registry.list()

    expect(records.map((record) => record.id)).toEqual(['acme.charlie', 'acme.alpha', 'acme.bravo'])
    expect(Object.isFrozen(records)).toBe(true)
    for (const record of records) {
      expect(Object.isFrozen(record)).toBe(true)
      expect(Object.isFrozen(record.manifest)).toBe(true)
      expect(Object.isFrozen(record.manifest.engines)).toBe(true)
    }
  })

  it('keeps the manifest captured at registration when the extension reassigns it', () => {
    const registry = createExtensionRegistry({ services: noServices })
    const extension = fixture('acme.alpha')
    registry.register(extension)

    ;(extension as { manifest: ExtensionManifest }).manifest = fixtureManifest('acme.impostor')

    expect(registry.get('acme.alpha')?.manifest.id).toBe('acme.alpha')
    expect(registry.list().map((record) => record.id)).toEqual(['acme.alpha'])
  })

  it('runs no extension code', () => {
    const activate = vi.fn()
    const deactivate = vi.fn()
    const services = vi.fn(noServices)
    const registry = createExtensionRegistry({ services })

    registry.register(fixture('acme.alpha', { activate, deactivate }))

    expect(activate).not.toHaveBeenCalled()
    expect(deactivate).not.toHaveBeenCalled()
    expect(services).not.toHaveBeenCalled()
  })
})

/** What a call made through an ended activation must throw. */
function expectDisposed(run: () => unknown): void {
  let thrown: unknown
  try {
    run()
  } catch (error) {
    thrown = error
  }
  expect(isExtensionError(thrown, 'disposed')).toBe(true)
}

const statuses = (records: readonly { id: string; status: string }[]) =>
  records.map((record) => [record.id, record.status])

describe('activate', () => {
  it('activates two extensions and lists both as active', async () => {
    const registry = createExtensionRegistry(recordingServices())
    registry.register(fixture('acme.alpha'))
    registry.register(fixture('acme.beta'))

    const records = await registry.activateAll()

    expect(statuses(records)).toEqual([
      ['acme.alpha', 'active'],
      ['acme.beta', 'active'],
    ])
    expect(registry.listActive().map((record) => record.id)).toEqual(['acme.alpha', 'acme.beta'])
  })

  it('isolates a synchronous throw, a rejection and a hang, and activates the rest', async () => {
    vi.useFakeTimers()
    const reports: ExtensionErrorReport[] = []
    const registry = createExtensionRegistry({ ...recordingServices(), onError: (report) => reports.push(report) })
    registry.register(fixture('acme.first'))
    registry.register(
      fixture('acme.throws', {
        activate() {
          throw Object.assign(new Error('sync boom'), { code: 'boom' })
        },
      }),
    )
    registry.register(fixture('acme.rejects', { activate: () => Promise.reject('not an Error') }))
    registry.register(fixture('acme.hangs', { activate: () => new Promise<void>(() => {}) }))
    registry.register(fixture('acme.last'))

    const done = registry.activateAll()
    await vi.advanceTimersByTimeAsync(10_000)
    const records = await done

    expect(statuses(records)).toEqual([
      ['acme.first', 'active'],
      ['acme.throws', 'failed'],
      ['acme.rejects', 'failed'],
      ['acme.hangs', 'failed'],
      ['acme.last', 'active'],
    ])
    expect(registry.get('acme.throws')?.error).toEqual({ code: 'boom', message: 'sync boom' })
    expect(registry.get('acme.rejects')?.error).toEqual({ message: 'not an Error' })
    expect(registry.get('acme.hangs')?.error).toEqual({
      code: 'activation-timeout',
      message: 'Extension "acme.hangs" did not finish activating within 10000 ms',
    })
    expect(reports.map((report) => [report.id, report.phase])).toEqual([
      ['acme.throws', 'activate'],
      ['acme.rejects', 'activate'],
      ['acme.hangs', 'activate'],
    ])
    expect(reports[2]?.error).toMatchObject({ code: 'activation-timeout' })
  })

  it('disposes what a failed activation registered and never calls its deactivate', async () => {
    const log: string[] = []
    const deactivate = vi.fn()
    const registry = createExtensionRegistry(recordingServices(log))
    registry.register(
      fixture('acme.partial', {
        activate(context) {
          context.commands.register(pingCommand('acme.partial'), () => {})
          context.subscriptions.push(disposable(log, 'dispose own timer'))
          throw new Error('half way')
        },
        deactivate,
      }),
    )

    const record = await registry.activate('acme.partial')

    expect(record).toMatchObject({ status: 'failed', error: { message: 'half way' } })
    expect(log).toEqual(['dispose own timer', 'dispose command acme.partial.ping'])
    expect(deactivate).not.toHaveBeenCalled()
  })

  it('ends a timed-out activation, so the hung code can no longer reach the context', async () => {
    vi.useFakeTimers()
    const hang = deferred()
    let context: ExtensionContext | undefined
    const registry = createExtensionRegistry({ ...recordingServices(), timeoutMs: 50 })
    registry.register(
      fixture('acme.slow', {
        activate(ctx) {
          context = ctx
          return hang.promise
        },
      }),
    )

    const pending = registry.activate('acme.slow')
    await vi.advanceTimersByTimeAsync(50)
    await pending

    expectDisposed(() => context?.commands.register(pingCommand('acme.slow'), () => {}))
    expectDisposed(() => context?.subscriptions.push(disposable([], 'late')))
  })

  it('ignores a late resolution and refuses a retry until the timed-out call settles', async () => {
    vi.useFakeTimers()
    const hang = deferred()
    const activate = vi.fn<Extension['activate']>().mockReturnValueOnce(hang.promise)
    const registry = createExtensionRegistry({ ...recordingServices(), timeoutMs: 50 })
    registry.register(fixture('acme.slow', { activate }))

    const first = registry.activate('acme.slow')
    await vi.advanceTimersByTimeAsync(50)
    expect((await first).error?.code).toBe('activation-timeout')

    const early = await registry.activate('acme.slow')
    expect(early.status).toBe('failed')
    expect(activate).toHaveBeenCalledTimes(1)

    hang.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(registry.get('acme.slow')?.status).toBe('failed')

    const retry = await registry.activate('acme.slow')
    expect(retry.status).toBe('active')
    expect(activate).toHaveBeenCalledTimes(2)
  })

  it('treats an unbounded `timeoutMs` as no practical limit rather than an instant timeout', async () => {
    // Real timers on purpose: an unclamped `setTimeout(…, Infinity)` fires at once.
    const registry = createExtensionRegistry({ ...recordingServices(), timeoutMs: Infinity })
    registry.register(fixture('acme.patient', { activate: () => new Promise<void>((done) => setTimeout(done, 20)) }))

    const record = await registry.activate('acme.patient')

    expect(record.status).toBe('active')
  })

  it('runs `activate` once for two overlapping calls', async () => {
    const gate = deferred()
    const activate = vi.fn(() => gate.promise)
    const registry = createExtensionRegistry(recordingServices())
    registry.register(fixture('acme.alpha', { activate }))

    const both = Promise.all([registry.activate('acme.alpha'), registry.activate('acme.alpha')])
    gate.resolve()
    const [first, second] = await both

    expect(activate).toHaveBeenCalledTimes(1)
    expect(first.status).toBe('active')
    expect(second).toBe(first)
  })

  it('activateAll skips disabled and failed extensions and ignores one registered while it runs', async () => {
    const disabled = vi.fn()
    const crash = vi.fn(() => {
      throw new Error('crash')
    })
    const late = vi.fn()
    const registry = createExtensionRegistry(recordingServices())
    registry.register(fixture('acme.off', { activate: disabled }), { enabled: false })
    registry.register(fixture('acme.crash', { activate: crash }))
    await registry.activate('acme.crash')
    registry.register(
      fixture('acme.first', {
        activate() {
          registry.register(fixture('acme.late', { activate: late }))
        },
      }),
    )

    await registry.activateAll()

    expect(disabled).not.toHaveBeenCalled()
    expect(crash).toHaveBeenCalledTimes(1)
    expect(late).not.toHaveBeenCalled()
    expect(statuses(registry.list())).toEqual([
      ['acme.off', 'disabled'],
      ['acme.crash', 'failed'],
      ['acme.first', 'active'],
      ['acme.late', 'registered'],
    ])
  })

  it('activates in registration order, one after another', async () => {
    const order: string[] = []
    const gate = deferred()
    const registry = createExtensionRegistry(recordingServices())
    registry.register(
      fixture('acme.alpha', {
        async activate() {
          order.push('alpha start')
          await gate.promise
          order.push('alpha end')
        },
      }),
    )
    registry.register(fixture('acme.beta', { activate: () => void order.push('beta') }))

    const done = registry.activateAll()
    await Promise.resolve()
    gate.resolve()
    await done

    expect(order).toEqual(['alpha start', 'alpha end', 'beta'])
  })

  it('retries a failed extension on an explicit activate', async () => {
    const activate = vi
      .fn<Extension['activate']>()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValue(undefined)
    const registry = createExtensionRegistry(recordingServices())
    registry.register(fixture('acme.flaky', { activate }))

    expect((await registry.activate('acme.flaky')).status).toBe('failed')
    const retry = await registry.activate('acme.flaky')

    expect(retry).toEqual({ id: 'acme.flaky', manifest: fixtureManifest('acme.flaky'), status: 'active' })
    expect(activate).toHaveBeenCalledTimes(2)
  })

  it('rejects an unknown id with unknown-extension', async () => {
    const registry = createExtensionRegistry(recordingServices())

    await expect(registry.activate('acme.nobody')).rejects.toMatchObject({
      name: 'ExtensionRegistryError',
      code: 'unknown-extension',
    })
  })

  it('calls `activate` as a method of the extension', async () => {
    let self: unknown
    const extension = defineExtension({
      manifest: fixtureManifest('acme.self'),
      activate() {
        self = this
      },
    })
    const registry = createExtensionRegistry(recordingServices())
    registry.register(extension)

    await registry.activate('acme.self')

    expect(self).toBe(extension)
  })

  it('keeps going when the onError reporter itself throws', async () => {
    const registry = createExtensionRegistry({
      ...recordingServices(),
      onError: () => {
        throw new Error('reporter is down')
      },
    })
    registry.register(fixture('acme.broken', { activate: () => Promise.reject(new Error('broken')) }))
    registry.register(fixture('acme.fine'))

    const records = await registry.activateAll()

    expect(statuses(records)).toEqual([
      ['acme.broken', 'failed'],
      ['acme.fine', 'active'],
    ])
  })

  it('fails the activation when the services factory throws', async () => {
    const activate = vi.fn()
    const registry = createExtensionRegistry({
      services: () => {
        throw new Error('storage backend is missing')
      },
      onError: () => {},
    })
    registry.register(fixture('acme.alpha', { activate }))

    const record = await registry.activate('acme.alpha')

    expect(record).toMatchObject({ status: 'failed', error: { message: 'storage backend is missing' } })
    expect(activate).not.toHaveBeenCalled()
  })

  it('hands `activate` a frozen context with the manifest, a subscriptions array and the services', async () => {
    let seen: ExtensionContext | undefined
    const recording = recordingServices()
    const registry = createExtensionRegistry(recording)
    const record = registry.register(
      fixture('acme.alpha', {
        activate(context) {
          seen = context
        },
      }),
    )

    await registry.activate('acme.alpha')

    expect(seen?.extension).toBe(record.manifest)
    expect(Object.isFrozen(seen)).toBe(true)
    expect(Array.isArray(seen?.subscriptions)).toBe(true)
    expect(seen?.subscriptions).toHaveLength(0)
    expect(recording.scopes).toHaveLength(1)
    expect(recording.scopes[0]?.extension).toBe(record.manifest)
  })
})

describe('deactivate', () => {
  it('awaits `deactivate` once, then disposes subscriptions and tracked registrations, each newest first', async () => {
    const log: string[] = []
    const deactivate = vi.fn(async () => {
      log.push('deactivate start')
      await Promise.resolve()
      log.push('deactivate end')
    })
    const registry = createExtensionRegistry(recordingServices(log))
    registry.register(
      fixture('acme.alpha', {
        activate(context) {
          context.commands.register(pingCommand('acme.alpha'), () => {})
          context.events.on(defineEvent('acme.alpha.tick'), () => {})
          context.subscriptions.push(disposable(log, 'dispose timer 1'), disposable(log, 'dispose timer 2'))
        },
        deactivate,
      }),
    )
    await registry.activate('acme.alpha')

    const record = await registry.deactivate('acme.alpha')

    expect(record).toEqual({ id: 'acme.alpha', manifest: fixtureManifest('acme.alpha'), status: 'registered' })
    expect(deactivate).toHaveBeenCalledTimes(1)
    expect(log).toEqual([
      'deactivate start',
      'deactivate end',
      'dispose timer 2',
      'dispose timer 1',
      'dispose listener acme.alpha.tick',
      'dispose command acme.alpha.ping',
    ])
    expect(registry.listActive()).toEqual([])
  })

  it('reports a throwing deactivate, a hanging one and a throwing dispose, and still completes disposal', async () => {
    vi.useFakeTimers()
    const log: string[] = []
    const reports: ExtensionErrorReport[] = []
    const registry = createExtensionRegistry({
      ...recordingServices(log),
      timeoutMs: 50,
      onError: (report) => reports.push(report),
    })
    const withSubscription = (id: string, deactivate: Extension['deactivate']) =>
      fixture(id, {
        activate: (context) => void context.subscriptions.push(disposable(log, `dispose ${id}`)),
        deactivate,
      })
    registry.register(
      withSubscription('acme.throws', () => {
        throw new Error('goodbye failed')
      }),
    )
    registry.register(withSubscription('acme.hangs', () => new Promise<void>(() => {})))
    registry.register(
      fixture('acme.leaky', {
        activate(context) {
          context.subscriptions.push(disposable(log, 'dispose acme.leaky older'), {
            dispose() {
              throw new Error('dispose failed')
            },
          })
        },
      }),
    )
    await registry.activateAll()

    const throws = await registry.deactivate('acme.throws')
    const hanging = registry.deactivate('acme.hangs')
    await vi.advanceTimersByTimeAsync(50)
    const hangs = await hanging
    const leaky = await registry.deactivate('acme.leaky')

    expect([throws.status, hangs.status, leaky.status]).toEqual(['registered', 'registered', 'registered'])
    expect(log).toEqual(['dispose acme.throws', 'dispose acme.hangs', 'dispose acme.leaky older'])
    expect(reports.map((report) => [report.id, report.phase])).toEqual([
      ['acme.throws', 'deactivate'],
      ['acme.hangs', 'deactivate'],
      ['acme.leaky', 'dispose'],
    ])
    expect(reports[1]?.error).toMatchObject({
      code: 'deactivation-timeout',
      message: 'Extension "acme.hangs" did not finish deactivating within 50 ms',
    })
  })

  it('makes every later call through the scope or the context fail with `disposed`, disposing what it was handed', async () => {
    const log: string[] = []
    const recording = recordingServices(log)
    let context: ExtensionContext | undefined
    const registry = createExtensionRegistry(recording)
    registry.register(
      fixture('acme.alpha', {
        activate(ctx) {
          context = ctx
        },
      }),
    )
    await registry.activate('acme.alpha')
    await registry.deactivate('acme.alpha')
    const scope = recording.scopes[0]

    expectDisposed(() => scope?.assertLive())
    expectDisposed(() => scope?.track(disposable(log, 'dispose late registration')))
    expectDisposed(() => context?.subscriptions.push(disposable(log, 'dispose late subscription')))
    expectDisposed(() => context?.commands.register(pingCommand('acme.alpha'), () => {}))
    expect(isExtensionError(await context?.storage.get('key').catch((error: unknown) => error), 'disposed')).toBe(true)

    expect(log).toEqual(['dispose late registration', 'dispose late subscription'])
    expect(context?.subscriptions).toHaveLength(0)
  })

  it('lets a tracked registration be disposed early, and never disposes it a second time', async () => {
    const log: string[] = []
    let registration: Disposable | undefined
    const registry = createExtensionRegistry(recordingServices(log))
    registry.register(
      fixture('acme.alpha', {
        activate(context) {
          registration = context.commands.register(pingCommand('acme.alpha'), () => {})
        },
      }),
    )
    await registry.activate('acme.alpha')

    registration?.dispose()
    registration?.dispose()
    await registry.deactivate('acme.alpha')

    expect(log).toEqual(['dispose command acme.alpha.ping'])
  })

  it('gives a re-activation a fresh context and scope', async () => {
    const contexts: ExtensionContext[] = []
    const recording = recordingServices()
    const registry = createExtensionRegistry(recording)
    registry.register(
      fixture('acme.alpha', {
        activate(context) {
          contexts.push(context)
          context.subscriptions.push(disposable([], 'timer'))
        },
      }),
    )

    await registry.activate('acme.alpha')
    await registry.deactivate('acme.alpha')
    await registry.activate('acme.alpha')

    expect(contexts).toHaveLength(2)
    expect(contexts[1]).not.toBe(contexts[0])
    expect(contexts[1]?.subscriptions).not.toBe(contexts[0]?.subscriptions)
    expect(contexts[1]?.subscriptions).toHaveLength(1)
    expect(recording.scopes).toHaveLength(2)
    expect(() => recording.scopes[1]?.assertLive()).not.toThrow()
  })

  it('runs `deactivate` once for two overlapping calls', async () => {
    const deactivate = vi.fn()
    const registry = createExtensionRegistry(recordingServices())
    registry.register(fixture('acme.alpha', { deactivate }))
    await registry.activate('acme.alpha')

    const [first, second] = await Promise.all([registry.deactivate('acme.alpha'), registry.deactivate('acme.alpha')])

    expect(deactivate).toHaveBeenCalledTimes(1)
    expect(first.status).toBe('registered')
    expect(second).toBe(first)
  })

  it('rejects an unknown id with unknown-extension', async () => {
    const registry = createExtensionRegistry(recordingServices())

    await expect(registry.deactivate('acme.nobody')).rejects.toMatchObject({
      name: 'ExtensionRegistryError',
      code: 'unknown-extension',
    })
  })
})

// § State machine. Rows not repeated here are covered above: register → registered/disabled
// ("register"), registered/failed → active and → failed, and the abandoned `activate` ("activate"),
// active → registered ("deactivate").
describe('state machine', () => {
  it('resolves a call that does not apply with the current record and no side effect', async () => {
    const calls: string[] = []
    const spy = (id: string, activate: Extension['activate'] = () => void calls.push(`activate ${id}`)) =>
      fixture(id, { activate, deactivate: () => void calls.push(`deactivate ${id}`) })
    const registry = createExtensionRegistry({ ...recordingServices(), onError: () => {} })
    registry.register(spy('acme.active'))
    registry.register(spy('acme.registered'))
    registry.register(spy('acme.off'), { enabled: false })
    registry.register(
      spy('acme.failed', () => {
        throw new Error('crash')
      }),
    )
    await registry.activate('acme.active')
    await registry.activate('acme.failed')
    calls.length = 0
    const before = new Map(registry.list().map((record) => [record.id, record]))

    const noOps = [
      ['activate', 'acme.active'],
      ['activate', 'acme.off'],
      ['deactivate', 'acme.registered'],
      ['deactivate', 'acme.failed'],
      ['deactivate', 'acme.off'],
    ] as const
    for (const [call, id] of noOps) {
      expect(await registry[call](id), `${call} on ${id}`).toBe(before.get(id))
    }

    expect(calls).toEqual([])
    expect(registry.list()).toEqual([...before.values()])
  })

  it('refuses to re-activate until a timed-out `deactivate` settles', async () => {
    vi.useFakeTimers()
    const hang = deferred()
    const activate = vi.fn()
    const registry = createExtensionRegistry({ ...recordingServices(), timeoutMs: 50, onError: () => {} })
    registry.register(fixture('acme.slow', { activate, deactivate: () => hang.promise }))
    await registry.activate('acme.slow')

    const pending = registry.deactivate('acme.slow')
    await vi.advanceTimersByTimeAsync(50)
    expect((await pending).status).toBe('registered')

    expect((await registry.activate('acme.slow')).status).toBe('registered')
    expect(activate).toHaveBeenCalledTimes(1)

    hang.resolve()
    await vi.advanceTimersByTimeAsync(0)

    expect((await registry.activate('acme.slow')).status).toBe('active')
    expect(activate).toHaveBeenCalledTimes(2)
  })
})

describe('onStatusChange', () => {
  const transitions = (calls: [{ id: string; status: string }, { status: string }][]) =>
    calls.map(([record, previous]) => `${record.id}: ${previous.status} → ${record.status}`)

  it('sees registered → active, active → registered and registered → failed, and nothing else', async () => {
    const seen: [{ id: string; status: string }, { status: string }][] = []
    const registry = createExtensionRegistry({
      ...recordingServices(),
      onError: () => {},
      onStatusChange: (record, previous) => seen.push([record, previous]),
    })
    registry.register(fixture('acme.alpha'))
    registry.register(
      fixture('acme.crash', {
        activate() {
          throw new Error('crash')
        },
      }),
    )
    registry.register(fixture('acme.off'), { enabled: false })
    expect(seen).toEqual([])

    await registry.activateAll()
    await registry.deactivate('acme.alpha')
    // A retried activation that fails again is not a status change.
    await registry.activate('acme.crash')

    expect(transitions(seen)).toEqual([
      'acme.alpha: registered → active',
      'acme.crash: registered → failed',
      'acme.alpha: active → registered',
    ])
    // The record handed over is the one the registry now holds; `previous` is the one it replaced.
    expect(seen[2]?.[0]).toBe(registry.get('acme.alpha'))
    expect(seen[2]?.[1]).toBe(seen[0]?.[0])
  })

  it('reports active once the extension’s registrations are live and its record is current', async () => {
    const log: string[] = []
    const { services } = recordingServices(log)
    let registration: Disposable | undefined
    let atCallback: { status: string | undefined; registered: boolean; disposed: number } | undefined
    const registry = createExtensionRegistry({
      services,
      onStatusChange: (record) => {
        atCallback = {
          status: registry.get(record.id)?.status,
          registered: registration !== undefined,
          disposed: log.length,
        }
      },
    })
    registry.register(
      fixture('acme.alpha', {
        async activate(context) {
          // Registered only after an await: the callback must still come after it.
          await Promise.resolve()
          registration = context.commands.register(pingCommand('acme.alpha'), () => {})
        },
      }),
    )

    await registry.activate('acme.alpha')

    // Registered, and still live (nothing disposed), when `active` is reported.
    expect(atCallback).toEqual({ status: 'active', registered: true, disposed: 0 })
  })

  it('swallows a throwing callback: the status and the other extensions are untouched', async () => {
    const registry = createExtensionRegistry({
      ...recordingServices(),
      onStatusChange: () => {
        throw new Error('callback is down')
      },
    })
    registry.register(fixture('acme.alpha'))
    registry.register(fixture('acme.beta'))

    const records = await registry.activateAll()

    expect(records.map((record) => [record.id, record.status])).toEqual([
      ['acme.alpha', 'active'],
      ['acme.beta', 'active'],
    ])
    await expect(registry.deactivate('acme.alpha')).resolves.toMatchObject({ status: 'registered' })
  })
})
