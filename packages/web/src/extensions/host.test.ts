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
  type ComponentImplementation,
  type Extension,
  type ExtensionActivation,
  type ExtensionContext,
} from '@open-mercato/cezar-extension-api'
import { registerCoreCommands } from '../commands/core-commands'
import { createCommandRegistry } from '../commands/registry'
import { listComponentChoices } from '../component-registry/choices'
import { createCoreComponentRegistry } from '../component-registry/core-components'
import { createComponentRegistry, type CockpitComponentRegistry } from '../component-registry/registry'
import { resolveComponent, type ComponentResolution } from '../component-registry/resolve'
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
 * The boot order `main.tsx` uses: the command registry with the core commands, the event bus and
 * the component registry with core's defaults first, then the host, with the bus's lifecycle events.
 */
function bootCockpit(
  extensions: readonly Extension[],
  busOptions: Parameters<typeof createEventBus>[0] = {},
  components: CockpitComponentRegistry = createCoreComponentRegistry(),
  notify: (message: string, options: { readonly tone: 'default' | 'warning' | 'danger' }) => void = () => {},
) {
  const commands = createCommandRegistry()
  registerCoreCommands(commands, { queryClient: new QueryClient() })
  const events = createEventBus(busOptions)
  const host = startExtensionHost({
    extensions,
    services: cockpitServices({ commands, events, components, notify }),
    onStatusChange: extensionLifecycleEvents(events),
    onError: () => {},
  })
  return { ...host, commands, events, components }
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

  it('grants built-ins their supported requests and fails closed on an unknown request', async () => {
    const activated: string[] = []
    const unknown = {
      manifest: { ...fixture('acme.unknown').manifest, permissions: ['teleport.machine'] },
      activate() {
        activated.push('unknown')
      },
    } as unknown as Extension
    const supported = fixture('acme.supported', {
      permissions: ['events'],
      activate(context) {
        activated.push(context.permissions.join(','))
      },
    })

    const { registry, ready } = startExtensionHost({
      extensions: [unknown, supported],
      ...recordingServices(),
      onError: () => {},
    })
    await ready

    expect(registry.get('acme.unknown')).toMatchObject({ status: 'failed', error: { code: 'unsupported-permission' } })
    expect(registry.get('acme.supported')?.status).toBe('active')
    expect(activated).toEqual(['events'])
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

  it('keeps storage on the placeholder', async () => {
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

    await expect(live.storage.get('key')).rejects.toThrow('context.storage is not available in this Cezar version yet')
  })

  it('exposes notifications only with its permission and maps the host toast contract', async () => {
    const shown: Array<{ message: string; tone: string }> = []
    let activeContext: ExtensionContext | undefined
    const { registry, ready } = bootCockpit(
      [
        fixture('acme.notify', {
          permissions: ['notifications'],
          activate(context) {
            activeContext = context
            context.notifications.info('hello')
            context.notifications.warning('heads up')
            context.notifications.error('broken')
          },
        }),
      ],
      {},
      undefined,
      (message, options) => shown.push({ message, tone: options.tone }),
    )
    await ready

    expect(registry.get('acme.notify')?.status).toBe('active')
    expect(activeContext?.permissions).toEqual(['notifications'])
    expect(shown).toEqual([
      { message: 'Fixture acme.notify: hello', tone: 'default' },
      { message: 'Fixture acme.notify: heads up', tone: 'warning' },
      { message: 'Fixture acme.notify: broken', tone: 'danger' },
    ])
  })

  it('denies notifications without running the injected toast function', async () => {
    const notify = vi.fn()
    const { registry, ready } = bootCockpit(
      [
        fixture('acme.denied', {
          permissions: [],
          activate(context) {
            context.notifications.info('not shown')
          },
        }),
      ],
      {},
      undefined,
      notify,
    )
    await ready

    expect(registry.get('acme.denied')).toMatchObject({ status: 'failed', error: { code: 'permission-denied' } })
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('the components service', () => {
  interface TaskHeaderProps {
    readonly title: string
  }

  /** The brief's `task.header@1`, as a fixture: the production catalog serves no contract yet. */
  const TaskHeader = defineComponentContract<TaskHeaderProps>('cezar.fixture.task-header', {
    version: 1,
    requiredCapabilities: ['shows-title'],
  })

  const header = (id: string, title: string): ComponentImplementation<TaskHeaderProps> => ({
    id,
    title,
    capabilities: ['shows-title'],
    component: () => null,
  })

  /** An extension that provides `<id>.task-header` from `activate()`. */
  const provider = (extensionId: string, title: string) =>
    fixture(extensionId, {
      activate(context) {
        context.components.provide(TaskHeader, header(`${extensionId}.task-header`, title))
      },
    })

  /** A cockpit serving the fixture contract, with core's default registered before the host starts. */
  function bootServingHeader(extensions: readonly Extension[]) {
    const components = createComponentRegistry({ contracts: [TaskHeader] })
    components.register(TaskHeader, header('core.fixture.task-header.default', 'Task header'), { default: true })
    return bootCockpit(extensions, {}, components)
  }

  const provenance = (components: CockpitComponentRegistry) =>
    components.list('cezar.fixture.task-header').map((registration) => [registration.componentId, registration.extensionId])

  it('DoD, end to end: one contract lists a core and two extension implementations, with their provenance', async () => {
    const { components, ready } = bootServingHeader([
      provider('acme.jira', 'Jira header'),
      provider('acme.compact', 'Compact header'),
    ])

    await ready

    expect(provenance(components)).toEqual([
      ['core.fixture.task-header.default', null],
      ['acme.jira.task-header', 'acme.jira'],
      ['acme.compact.task-header', 'acme.compact'],
    ])
    expect(components.list('cezar.fixture.task-header').map((registration) => registration.metadata.title)).toEqual([
      'Task header',
      'Jira header',
      'Compact header',
    ])
    expect(components.listUsable(TaskHeader)).toEqual(components.list('cezar.fixture.task-header'))
  })

  it('DoD, capability choices expose complete implementations and explain incomplete ones', async () => {
    interface CapabilityHeaderProps {
      readonly title: string
    }
    const CapabilityHeader = defineComponentContract<CapabilityHeaderProps>('cezar.fixture.capability-header', {
      version: 1,
      requiredCapabilities: ['task.status', 'task.continue'],
    })
    const implementation = (id: string, capabilities: readonly string[]): ComponentImplementation<CapabilityHeaderProps> => ({
      id,
      title: id,
      capabilities,
      component: () => null,
    })
    const components = createComponentRegistry({ contracts: [CapabilityHeader], onDiagnostic: () => {} })
    components.register(
      CapabilityHeader,
      implementation('core.fixture.capability-header.default', ['task.status', 'task.continue']),
      { default: true },
    )
    const { registry, ready } = bootCockpit(
      [
        fixture('acme.jira', {
          activate(context) {
            context.components.provide(
              CapabilityHeader,
              implementation('acme.jira.capability-header', ['task.status', 'task.continue', 'jira.issue.create']),
            )
          },
        }),
        fixture('acme.partial', {
          activate(context) {
            context.components.provide(
              CapabilityHeader,
              implementation('acme.partial.capability-header', ['task.status']),
            )
          },
        }),
      ],
      {},
      components,
    )

    await ready

    const choices = listComponentChoices(components, CapabilityHeader)
    expect(choices.status).toBe('resolved')
    if (choices.status !== 'resolved') throw new Error('expected resolved choices')
    expect(choices.overrides.map((entry) => entry.componentId)).toEqual(['acme.jira.capability-header'])
    expect(choices.overrides[0]?.customCapabilities).toEqual(['jira.issue.create'])
    expect(choices.unavailable.map((entry) => entry.componentId)).toEqual(['acme.partial.capability-header'])
    expect(choices.unavailable[0]?.missingCapabilities).toEqual(['task.continue'])

    const fallback = resolveComponent(components, CapabilityHeader, 'acme.partial.capability-header')
    expect(fallback).toMatchObject({
      status: 'resolved',
      source: 'default',
      component: components.get('core.fixture.capability-header.default'),
      rejected: { reason: 'incompatible', componentId: 'acme.partial.capability-header' },
    })
    expect(registry.get('acme.jira')?.status).toBe('active')
    expect(registry.get('acme.partial')?.status).toBe('active')
  })

  it('removes an extension’s implementation when that extension deactivates', async () => {
    const { registry, components, ready } = bootServingHeader([
      provider('acme.jira', 'Jira header'),
      provider('acme.compact', 'Compact header'),
    ])
    await ready

    await registry.deactivate('acme.jira')

    expect(provenance(components)).toEqual([
      ['core.fixture.task-header.default', null],
      ['acme.compact.task-header', 'acme.compact'],
    ])
  })

  it('fails only the extension that provides the same id twice, with duplicate-registration', async () => {
    const { registry, components, ready } = bootServingHeader([
      provider('acme.jira', 'Jira header'),
      fixture('acme.twice', {
        activate(context) {
          context.components.provide(TaskHeader, header('acme.twice.task-header', 'Twice'))
          context.components.provide(TaskHeader, header('acme.twice.task-header', 'Twice again'))
        },
      }),
      provider('acme.compact', 'Compact header'),
    ])

    await ready

    expect(registry.get('acme.twice')).toMatchObject({ status: 'failed', error: { code: 'duplicate-registration' } })
    expect(registry.get('acme.jira')?.status).toBe('active')
    expect(registry.get('acme.compact')?.status).toBe('active')
    // The failed activation's first registration went with it.
    expect(provenance(components)).toEqual([
      ['core.fixture.task-header.default', null],
      ['acme.jira.task-header', 'acme.jira'],
      ['acme.compact.task-header', 'acme.compact'],
    ])
  })

  it('keeps an extension active when the production catalog does not serve its contract, and reports it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { registry, components, ready } = bootCockpit([provider('acme.jira', 'Jira header')])

    await ready

    expect(registry.get('acme.jira')?.status).toBe('active')
    expect(components.get('acme.jira.task-header')).toMatchObject({
      compatible: false,
      issues: [{ code: 'unknown-contract', contractId: 'cezar.fixture.task-header' }],
    })
    expect(components.listUsable(TaskHeader)).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  describe('resolving which implementation renders', () => {
    const DEFAULT = 'core.fixture.task-header.default'
    const JIRA = 'acme.jira.task-header'
    const COMPACT = 'acme.compact.task-header'

    const TaskHeaderV2 = defineComponentContract<TaskHeaderProps>('cezar.fixture.task-header', {
      version: 2,
      requiredCapabilities: ['shows-title'],
    })

    /** A resolution by ids, comparable across two boots whose registrations are different objects. */
    const byId = (resolution: ComponentResolution<TaskHeaderProps>) =>
      resolution.status === 'unresolved'
        ? resolution
        : {
            component: resolution.component.componentId,
            fallback: resolution.fallback.componentId,
            source: resolution.source,
            rejected: resolution.source === 'default' ? resolution.rejected : undefined,
          }

    it('DoD, the brief’s example: the chosen extension renders, and core’s default renders with no choice', async () => {
      const { components, ready } = bootServingHeader([
        provider('acme.jira', 'Jira header'),
        provider('acme.compact', 'Compact header'),
      ])

      await ready

      expect(resolveComponent(components, TaskHeader, JIRA)).toEqual({
        status: 'resolved',
        component: components.get(JIRA),
        fallback: components.get(DEFAULT),
        source: 'preference',
      })
      expect(resolveComponent(components, TaskHeader)).toEqual({
        status: 'resolved',
        component: components.get(DEFAULT),
        fallback: components.get(DEFAULT),
        source: 'default',
      })
    })

    it('DoD, removing an extension: the same call falls back to core’s default, never unresolved', async () => {
      const { registry, components, ready } = bootServingHeader([
        provider('acme.jira', 'Jira header'),
        provider('acme.compact', 'Compact header'),
      ])
      await ready
      const before = resolveComponent(components, TaskHeader, JIRA)

      await registry.deactivate('acme.jira')
      const after = resolveComponent(components, TaskHeader, JIRA)

      expect(after).toEqual({
        status: 'resolved',
        component: components.get(DEFAULT),
        fallback: components.get(DEFAULT),
        source: 'default',
        rejected: { reason: 'not-found', componentId: JIRA },
      })
      if (before.status !== 'resolved' || after.status !== 'resolved') throw new Error('expected resolved results')
      expect(before.component.componentId).toBe(JIRA)
      expect(after.fallback).toBe(before.fallback)
    })

    it('DoD, an incompatible implementation is not used: acme.jira built for @2 is set aside', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { registry, components, ready } = bootServingHeader([
        fixture('acme.jira', {
          activate(context) {
            context.components.provide(TaskHeaderV2, header(JIRA, 'Jira header'))
          },
        }),
      ])

      await ready

      expect(registry.get('acme.jira')?.status).toBe('active')
      expect(resolveComponent(components, TaskHeader, JIRA)).toMatchObject({
        status: 'resolved',
        component: components.get(DEFAULT),
        source: 'default',
        rejected: {
          reason: 'incompatible',
          componentId: JIRA,
          issues: [{ code: 'contract-version-mismatch', expected: 1, actual: 2 }],
        },
      })
    })

    it('sets aside an extension whose activate threw after it provided, and keeps the others choosable', async () => {
      const { registry, components, ready } = bootServingHeader([
        fixture('acme.jira', {
          activate(context) {
            context.components.provide(TaskHeader, header(JIRA, 'Jira header'))
            throw new Error('jira broke')
          },
        }),
        provider('acme.compact', 'Compact header'),
      ])

      await ready

      expect(registry.get('acme.jira')?.status).toBe('failed')
      expect(registry.get('acme.compact')?.status).toBe('active')
      expect(resolveComponent(components, TaskHeader, JIRA)).toMatchObject({
        component: components.get(DEFAULT),
        source: 'default',
        rejected: { reason: 'not-found', componentId: JIRA },
      })
      expect(resolveComponent(components, TaskHeader, COMPACT)).toMatchObject({
        component: components.get(COMPACT),
        source: 'preference',
      })
    })

    it('resolves the same way whichever order the extensions activated in', async () => {
      const boot = async (extensions: readonly Extension[]) => {
        const { components, ready } = bootServingHeader(extensions)
        await ready
        return components
      }
      const forward = await boot([provider('acme.jira', 'Jira header'), provider('acme.compact', 'Compact header')])
      const backward = await boot([provider('acme.compact', 'Compact header'), provider('acme.jira', 'Jira header')])

      expect(provenance(backward)).not.toEqual(provenance(forward))
      for (const preference of [undefined, JIRA, COMPACT, DEFAULT, 'acme.gone.task-header']) {
        expect(byId(resolveComponent(backward, TaskHeader, preference))).toEqual(
          byId(resolveComponent(forward, TaskHeader, preference)),
        )
      }
    })
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
    registry.register(fixture('acme.alpha'), { grantedPermissions: ['ui.components', 'commands.execute', 'storage', 'events', 'network', 'notifications'] })
    registry.register(
      fixture('acme.crash', {
        activate() {
          throw new Error('crash')
        },
      }),
      { grantedPermissions: ['ui.components', 'commands.execute', 'storage', 'events', 'network', 'notifications'] },
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
