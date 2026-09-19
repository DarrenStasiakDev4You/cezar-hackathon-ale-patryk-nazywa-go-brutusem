import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  defineCommand,
  defineComponentContract,
  defineEvent,
  ExtensionActivated,
  isExtensionError,
  TaskArchive,
  TaskContinue,
  type Extension,
  type ExtensionActivation,
  type ExtensionContext,
} from '@open-mercato/cezar-extension-api'
import { registerCoreCommands } from '../commands/core-commands'
import { createCommandRegistry } from '../commands/registry'
import { createEventBus, type EventErrorReport } from '../events/bus'
import { BUILTIN_EXTENSIONS } from './builtin-extensions'
import { cockpitServices, extensionLifecycleEvents, startExtensionHost, unavailableServices } from './host'
import { fixture, pingCommand, recordingServices } from './registry.fixtures'
import { createExtensionRegistry, type ExtensionErrorReport } from './registry'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const statuses = (records: readonly { id: string; status: string }[]) =>
  records.map((record) => [record.id, record.status])

function thrown(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

/**
 * The boot order `main.tsx` uses: the command registry with the core commands and the event bus
 * first, then the host, with the bus's lifecycle events.
 */
function bootCockpit(extensions: readonly Extension[], busOptions: Parameters<typeof createEventBus>[0] = {}) {
  const commands = createCommandRegistry()
  registerCoreCommands(commands, { queryClient: new QueryClient() })
  const events = createEventBus(busOptions)
  const host = startExtensionHost({
    extensions,
    services: cockpitServices({ commands, events }),
    onStatusChange: extensionLifecycleEvents(events),
    onError: () => {},
  })
  return { ...host, commands, events }
}

describe('startExtensionHost', () => {
  it('activates every extension it is given once `ready` resolves', async () => {
    const { registry, ready } = startExtensionHost({
      extensions: [fixture('acme.alpha'), fixture('acme.beta')],
      ...recordingServices(),
    })

    const records = await ready

    expect(statuses(records)).toEqual([
      ['acme.alpha', 'active'],
      ['acme.beta', 'active'],
    ])
    expect(registry.listActive().map((record) => record.id)).toEqual(['acme.alpha', 'acme.beta'])
  })

  it('reports an invalid entry, a duplicate id and a throwing activate, and still boots the rest', async () => {
    const reports: ExtensionErrorReport[] = []
    const invalid = { manifest: { id: 'Not An Id' }, activate() {} } as unknown as Extension
    const extensions = [
      fixture('acme.alpha'),
      invalid,
      fixture('acme.alpha'),
      fixture('acme.crash', {
        activate() {
          throw new Error('crash')
        },
      }),
      fixture('acme.beta'),
    ]

    let started: ReturnType<typeof startExtensionHost> | undefined
    expect(() => {
      started = startExtensionHost({ extensions, ...recordingServices(), onError: (report) => reports.push(report) })
    }).not.toThrow()
    const records = await started?.ready

    expect(statuses(records ?? [])).toEqual([
      ['acme.alpha', 'active'],
      ['acme.crash', 'failed'],
      ['acme.beta', 'active'],
    ])
    expect(reports.map((report) => [report.id, report.phase])).toEqual([
      ['Not An Id', 'register'],
      ['acme.alpha', 'register'],
      ['acme.crash', 'activate'],
    ])
    expect(reports[0]?.error).toMatchObject({ code: 'invalid-extension' })
    expect(reports[1]?.error).toMatchObject({ code: 'duplicate-extension' })
  })

  it('survives a reporter that throws while registration fails', async () => {
    const { ready } = startExtensionHost({
      extensions: [null as unknown as Extension, fixture('acme.alpha')],
      ...recordingServices(),
      onError: () => {
        throw new Error('reporter is down')
      },
    })

    expect(statuses(await ready)).toEqual([['acme.alpha', 'active']])
  })

  it('logs to the console with the `[cezar:extensions]` prefix by default', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    await startExtensionHost({ extensions: [null as unknown as Extension], ...recordingServices() }).ready

    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toBe('[cezar:extensions] (no id): register failed')
  })
})

describe('unavailableServices', () => {
  const pingEvent = defineEvent('acme.alpha.pinged')
  const listContract = defineComponentContract<Record<string, never>>('cezar.fixture.list', { version: 1 })

  it('fails an extension that uses a service with the "not available yet" message', async () => {
    const { registry, ready } = startExtensionHost({
      extensions: [
        fixture('acme.commands', {
          activate(context) {
            context.commands.register(pingCommand('acme.commands'), () => {})
          },
        }),
        fixture('acme.quiet'),
      ],
      onError: () => {},
    })

    await ready

    expect(registry.get('acme.commands')).toMatchObject({
      status: 'failed',
      error: { message: 'context.commands is not available in this Cezar version yet' },
    })
    expect(registry.get('acme.quiet')?.status).toBe('active')
  })

  it('fails every placeholder call with `disposed` once the extension has deactivated', async () => {
    let context: ExtensionContext | undefined
    const { registry, ready } = startExtensionHost({
      extensions: [
        fixture('acme.alpha', {
          activate(ctx) {
            context = ctx
          },
        }),
      ],
    })
    await ready
    const live = context as ExtensionContext

    for (const call of [
      () => live.events.on(pingEvent, () => {}),
      () => live.events.once(pingEvent, () => {}),
      () => live.events.off(pingEvent, () => {}),
      () => live.events.emit(pingEvent),
    ]) {
      expect(call).toThrow('context.events is not available in this Cezar version yet')
    }
    await expect(live.storage.get('key')).rejects.toThrow('context.storage is not available in this Cezar version yet')

    await registry.deactivate('acme.alpha')

    for (const call of [
      () => live.commands.register(pingCommand('acme.alpha'), () => {}),
      () => live.commands.has(pingCommand('acme.alpha')),
      () => live.events.on(pingEvent, () => {}),
      () => live.events.once(pingEvent, () => {}),
      () => live.events.off(pingEvent, () => {}),
      () => live.events.emit(pingEvent),
      () => live.components.provide(listContract, { id: 'acme.alpha.list', title: 'List', component: () => null }),
    ]) {
      expect(isExtensionError(thrown(call), 'disposed')).toBe(true)
    }
    for (const call of [
      () => live.commands.execute(pingCommand('acme.alpha')),
      () => live.storage.get('key'),
      () => live.storage.set('key', 1),
      () => live.storage.delete('key'),
      () => live.storage.keys(),
    ]) {
      expect(isExtensionError(await call().catch((error: unknown) => error), 'disposed')).toBe(true)
    }
  })
})

describe('cockpitServices', () => {
  const Internal = defineCommand<[input: { readonly taskId: string }], string>('cezar.fixture.internal')

  function boot(extensions: readonly Extension[]) {
    const booted = bootCockpit(extensions)
    booted.commands.register(Internal, ({ taskId }) => taskId, {
      visibility: 'internal',
      validate: (args): [{ taskId: string }] => [args[0] as { taskId: string }],
    })
    return booted
  }

  it('lets an extension execute a public core command against the API', async () => {
    const sent: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        sent.push(`${init.method ?? 'GET'} ${String(input)} ${String(init.body)}`)
        return new Response(JSON.stringify({ id: 'r1', archived: true }), {
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    let result: unknown
    const { registry, ready } = boot([
      fixture('acme.archiver', {
        async activate(context) {
          result = await context.commands.execute(TaskArchive, { taskId: 'r1' })
        },
      }),
    ])

    await ready

    expect(registry.get('acme.archiver')?.status).toBe('active')
    expect(result).toEqual({ taskId: 'r1', archived: true })
    expect(sent).toEqual(['POST /api/v1/runs/r1/archive {"archived":true}'])
  })

  it('lets an extension continue a task on another engine, with a prompt — the composer’s own continue', async () => {
    const sent: { path: string; body: unknown }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        sent.push({ path: `${init.method ?? 'GET'} ${String(input)}`, body: JSON.parse(String(init.body)) })
        return new Response(JSON.stringify({ continued: true }), { headers: { 'content-type': 'application/json' } })
      }),
    )
    let result: unknown
    const { registry, ready } = boot([
      fixture('acme.steer', {
        async activate(context) {
          result = await context.commands.execute(TaskContinue, {
            taskId: 'r1',
            projectId: 'web',
            runner: 'codex',
            model: 'gpt-5.1-codex',
            text: 'Now fix the lint errors.',
          })
        },
      }),
    ])

    await ready

    expect(registry.get('acme.steer')?.status).toBe('active')
    expect(result).toEqual({ taskId: 'r1', continued: true })
    expect(sent).toEqual([
      {
        path: 'POST /api/v1/p/web/runs/r1/continue',
        body: { text: 'Now fix the lint errors.', runner: 'codex', model: 'gpt-5.1-codex' },
      },
    ])
  })

  it('hides an internal core command: has is false and execute answers command-not-found', async () => {
    let seen: { has: boolean; error: unknown } | undefined
    const { ready } = boot([
      fixture('acme.curious', {
        async activate(context) {
          seen = {
            has: context.commands.has(Internal),
            error: await context.commands.execute(Internal, { taskId: 'r1' }).catch((error: unknown) => error),
          }
        },
      }),
    ])

    await ready

    expect(seen?.has).toBe(false)
    expect(isExtensionError(seen?.error, 'command-not-found')).toBe(true)
  })

  it('shares an extension command with the others, and removes it when its provider deactivates', async () => {
    const Ping = defineCommand<[count: number], string>('acme.alpha.ping')
    let beta: ExtensionContext | undefined
    const { registry, commands, ready } = boot([
      fixture('acme.alpha', {
        activate(context) {
          context.commands.register(Ping, (count) => `pong ${count}`)
        },
      }),
      fixture('acme.beta', {
        activate(context) {
          beta = context
        },
      }),
    ])
    await ready

    expect(beta?.commands.has(Ping)).toBe(true)
    await expect(beta?.commands.execute(Ping, 2)).resolves.toBe('pong 2')

    await registry.deactivate('acme.alpha')

    expect(commands.has(Ping)).toBe(false)
    expect(beta?.commands.has(Ping)).toBe(false)
  })

  it('keeps its providing extension active when a handler throws — only the caller sees the failure', async () => {
    const Broken = defineCommand<[count: number], string>('acme.alpha.broken')
    let beta: ExtensionContext | undefined
    const { registry, ready } = boot([
      fixture('acme.alpha', {
        activate(context) {
          context.commands.register(Broken, () => {
            throw new Error('alpha broke')
          })
        },
      }),
      fixture('acme.beta', {
        activate(context) {
          beta = context
        },
      }),
    ])
    await ready

    const error = await beta?.commands.execute(Broken, 1).catch((reason: unknown) => reason)

    expect(isExtensionError(error, 'command-failed')).toBe(true)
    expect((error as Error).message).toBe('alpha broke')
    expect(registry.get('acme.alpha')?.status).toBe('active')
    expect(beta?.commands.has(Broken)).toBe(true)
  })

  it('keeps storage and components on the placeholders', async () => {
    const list = defineComponentContract<Record<string, never>>('cezar.fixture.list', { version: 1 })
    let context: ExtensionContext | undefined
    const { ready } = boot([
      fixture('acme.alpha', {
        activate(ctx) {
          context = ctx
        },
      }),
    ])
    await ready
    const live = context as ExtensionContext

    expect(() => live.components.provide(list, { id: 'acme.alpha.list', title: 'List', component: () => null })).toThrow(
      'context.components is not available in this Cezar version yet',
    )
    await expect(live.storage.get('key')).rejects.toThrow('context.storage is not available in this Cezar version yet')
  })
})

describe('the events service', () => {
  const AlphaReady = defineEvent<{ readonly step: number }>('acme.alpha.ready')
  const BetaReady = defineEvent<{ readonly step: number }>('acme.beta.ready')

  it('DoD 1, end to end: an extension hears a later extension’s activation, with its id and version', async () => {
    const heard: ExtensionActivation[] = []
    const { registry, ready } = bootCockpit([
      fixture('acme.listener', {
        activate(context) {
          context.events.on(ExtensionActivated, (activation) => heard.push(activation))
        },
      }),
      fixture('acme.later'),
    ])

    await ready
    await vi.waitFor(() => expect(heard).toHaveLength(2))

    // It hears its own activation too: the emit comes after its listener is live.
    expect(heard).toEqual([
      { extensionId: 'acme.listener', version: '1.0.0' },
      { extensionId: 'acme.later', version: '1.0.0' },
    ])
    expect(registry.listActive().map((record) => record.id)).toEqual(['acme.listener', 'acme.later'])
  })

  it('DoD 4, end to end: after deactivate resolves, neither a core nor an extension emit reaches it', async () => {
    const heard: string[] = []
    let beta: ExtensionContext | undefined
    let alpha: ExtensionContext | undefined
    const { registry, events, ready } = bootCockpit([
      fixture('acme.alpha', {
        activate(context) {
          alpha ??= context
          context.events.on(ExtensionActivated, ({ extensionId }) => heard.push(`activated ${extensionId}`))
          context.events.on(BetaReady, ({ step }) => heard.push(`beta ${step}`))
          context.events.once(AlphaReady, ({ step }) => heard.push(`own ${step}`))
        },
      }),
      fixture('acme.beta', {
        activate(context) {
          beta = context
        },
      }),
    ])
    await ready
    await vi.waitFor(() => expect(heard).toEqual(['activated acme.alpha', 'activated acme.beta']))

    // (A delivery queued before the scope ends and cancelled by it is proven at the bus level: here
    // `deactivate()` itself takes microtasks, and the extension stays active while it runs.)
    await registry.deactivate('acme.alpha')
    events.emit(ExtensionActivated, { extensionId: 'acme.gamma', version: '1.0.0' })
    beta?.events.emit(BetaReady, { step: 2 })
    await registry.activate('acme.alpha')
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Only the new activation's listener hears its own re-activation; the old ones are gone.
    expect(heard).toEqual(['activated acme.alpha', 'activated acme.beta', 'activated acme.alpha'])
    // The first activation's context refuses every call.
    expect(isExtensionError(thrown(() => alpha?.events.emit(AlphaReady, { step: 3 })), 'disposed')).toBe(true)
  })

  it('leaves no listener behind when activate subscribes and then throws', async () => {
    const heard: string[] = []
    const { registry, ready } = bootCockpit([
      fixture('acme.crash', {
        activate(context) {
          context.events.on(BetaReady, ({ step }) => heard.push(`crash heard ${step}`))
          throw new Error('crash after subscribing')
        },
      }),
      fixture('acme.beta', {
        activate(context) {
          context.events.emit(BetaReady, { step: 1 })
        },
      }),
    ])

    await ready
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(registry.get('acme.crash')?.status).toBe('failed')
    expect(heard).toEqual([])
  })

  it('keeps the extension that owns a failing listener active, and reports the failure', async () => {
    const reports: EventErrorReport[] = []
    const after: number[] = []
    const { registry, ready } = bootCockpit(
      [
        fixture('acme.alpha', {
          activate(context) {
            context.events.on(BetaReady, () => {
              throw new Error('alpha listener broke')
            })
            context.events.on(BetaReady, ({ step }) => after.push(step))
          },
        }),
        fixture('acme.beta', {
          activate(context) {
            context.events.emit(BetaReady, { step: 7 })
          },
        }),
      ],
      { onError: (report) => reports.push(report) },
    )

    await ready
    await vi.waitFor(() => expect(after).toEqual([7]))

    expect(registry.get('acme.alpha')?.status).toBe('active')
    expect(registry.get('acme.beta')?.status).toBe('active')
    expect(reports.map(({ extensionId, eventId, kind }) => [extensionId, eventId, kind])).toEqual([
      ['acme.alpha', 'acme.beta.ready', 'listener'],
    ])
  })

  it('refuses an extension emitting a core event, failing that activation only', async () => {
    const { registry, ready } = bootCockpit([
      fixture('acme.spoof', {
        activate(context) {
          context.events.emit(ExtensionActivated, { extensionId: 'acme.fake', version: '9.9.9' })
        },
      }),
      fixture('acme.quiet'),
    ])

    await ready

    expect(registry.get('acme.spoof')).toMatchObject({ status: 'failed', error: { code: 'namespace-violation' } })
    expect(registry.get('acme.quiet')?.status).toBe('active')
  })
})

describe('extensionLifecycleEvents', () => {
  it('emits cezar.extension.activated for a record that became active, and nothing for another change', async () => {
    const events = createEventBus()
    const heard: ExtensionActivation[] = []
    events.on(ExtensionActivated, (activation) => heard.push(activation))
    const onStatusChange = extensionLifecycleEvents(events)
    const registry = createExtensionRegistry({ ...recordingServices(), onStatusChange, onError: () => {} })
    registry.register(fixture('acme.alpha'))
    registry.register(
      fixture('acme.crash', {
        activate() {
          throw new Error('crash')
        },
      }),
    )

    await registry.activateAll()
    await registry.deactivate('acme.alpha')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(heard).toEqual([{ extensionId: 'acme.alpha', version: '1.0.0' }])
  })
})

describe('BUILTIN_EXTENSIONS', () => {
  it('registers cleanly into a fresh registry', () => {
    const registry = createExtensionRegistry({ services: unavailableServices })

    for (const extension of BUILTIN_EXTENSIONS) registry.register(extension)

    expect(registry.list()).toHaveLength(BUILTIN_EXTENSIONS.length)
  })

  it('boots with no error reported', async () => {
    const onError = vi.fn()

    const records = await startExtensionHost({ extensions: BUILTIN_EXTENSIONS, onError }).ready

    expect(onError).not.toHaveBeenCalled()
    expect(records.every((record) => record.status === 'active')).toBe(true)
  })
})
