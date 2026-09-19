import type { ComponentType } from 'react'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
  defineComponentContract,
  type ComponentContract,
  type ComponentImplementation,
} from '@open-mercato/cezar-extension-api'

import { fakeScope } from '../extensions/registry.fixtures'
import {
  createComponentRegistry,
  type AnyComponentContract,
  type CockpitComponentRegistry,
  type UsableComponent,
} from './registry'
import {
  coreDefaultComponentId,
  missingCoreDefaults,
  resolveComponent,
  type ComponentResolution,
  type PreferenceRejection,
  type ResolvedComponent,
  type ResolverRegistry,
} from './resolve'

afterEach(() => {
  vi.restoreAllMocks()
})

interface HeaderProps {
  readonly title: string
}

interface ListProps {
  readonly runIds: readonly string[]
}

/** The brief's `task.header@1`, as a fixture contract: nothing in production serves it. */
const Header = defineComponentContract<HeaderProps>('cezar.fixture.task-header', {
  version: 1,
  requiredCapabilities: ['shows-title'],
  optionalCapabilities: ['compact'],
})

const HeaderV2 = defineComponentContract<HeaderProps>('cezar.fixture.task-header', { version: 2 })

/** A second served contract, for a preference that names another contract's implementation. */
const TaskList = defineComponentContract<ListProps>('cezar.fixture.task-list', { version: 1 })

const Render: ComponentType<HeaderProps> = () => null
const RenderList: ComponentType<ListProps> = () => null

const DEFAULT_ID = 'cezar.fixture.task-header.default'
const COMPACT_ID = 'cezar.fixture.task-header.compact'
const JIRA_ID = 'acme.jira.task-header'
const ACME_COMPACT_ID = 'acme.compact.task-header'
const JIRA_LIST_ID = 'acme.jira.task-list'
const GONE_ID = 'acme.gone.task-header'

const header = (
  id: string,
  title: string,
  capabilities: readonly string[] = ['shows-title'],
): ComponentImplementation<HeaderProps> => ({ id, title, capabilities, component: Render })

/** A registry serving both fixture contracts. A misfit is recorded quietly. */
const servedRegistry = () => createComponentRegistry({ contracts: [Header, TaskList], onDiagnostic: () => {} })

const registerDefault = (registry: CockpitComponentRegistry) => registry.register(Header, header(DEFAULT_ID, 'Task header'))
const registerCompact = (registry: CockpitComponentRegistry) => registry.register(Header, header(COMPACT_ID, 'Compact header'))

/** `extensionId` provides `<extensionId>.task-header` through its own scope. */
function provide(
  registry: CockpitComponentRegistry,
  extensionId: string,
  contract: ComponentContract<HeaderProps> = Header,
  capabilities: readonly string[] = ['shows-title'],
) {
  const { scope, end } = fakeScope(extensionId)
  const handle = registry
    .forExtension(scope)
    .provide(contract, header(`${extensionId}.task-header`, `${extensionId} header`, capabilities))
  return { handle, end }
}

/** `acme.jira` also provides an implementation of the second served contract. */
const provideJiraList = (registry: CockpitComponentRegistry) =>
  registry
    .forExtension(fakeScope('acme.jira').scope)
    .provide(TaskList, { id: JIRA_LIST_ID, title: 'Jira list', component: RenderList })

/** The brief's registry: core's default and compact headers, and `acme.jira` and `acme.compact`. */
function populated(): CockpitComponentRegistry {
  const registry = servedRegistry()
  registerDefault(registry)
  registerCompact(registry)
  provide(registry, 'acme.jira')
  provide(registry, 'acme.compact')
  return registry
}

function resolved<P>(resolution: ComponentResolution<P>): ResolvedComponent<P> {
  if (resolution.status !== 'resolved') throw new Error('expected a resolved result')
  return resolution
}

/** Why the preference was set aside, from a result that must have set it aside. */
function rejectionOf<P>(resolution: ComponentResolution<P>): PreferenceRejection {
  const result = resolved(resolution)
  if (result.source !== 'default' || result.rejected === undefined) throw new Error('expected a set-aside preference')
  return result.rejected
}

/** Type-level only: renders nothing, but refuses props that do not fit the component. */
function renderWith<P>(component: ComponentType<P>, props: NoInfer<P>): void {
  void component
  void props
}

/** A revoked proxy: every property read on it throws a TypeError. */
function revoked(): object {
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  return proxy
}

describe('coreDefaultComponentId', () => {
  it('names core’s default under the contract id', () => {
    expect(coreDefaultComponentId('cezar.task.header')).toBe('cezar.task.header.default')
    expect(coreDefaultComponentId(Header.id)).toBe(DEFAULT_ID)
  })
})

describe('resolveComponent', () => {
  describe('with no preference', () => {
    it.each<[string, () => ComponentResolution<HeaderProps>]>([
      ['no argument', () => resolveComponent(populated(), Header)],
      ['undefined', () => resolveComponent(populated(), Header, undefined)],
      ['null', () => resolveComponent(populated(), Header, null)],
    ])('renders core’s default for %s, with no rejected key', (_label, resolve) => {
      const result = resolved(resolve())

      expect(result.source).toBe('default')
      expect(Object.keys(result)).not.toContain('rejected')
      expect(result.component).toBe(result.fallback)
      expect(result.component.componentId).toBe(DEFAULT_ID)
      expect(result.component.extensionId).toBeNull()
    })

    it('hands out the registry’s own registration as both the component and the fallback', () => {
      const registry = populated()

      const result = resolved(resolveComponent(registry, Header))

      expect(result.component).toBe(registry.get(DEFAULT_ID))
      expect(result.fallback).toBe(registry.get(DEFAULT_ID))
    })

    it.each<[string, (registry: CockpitComponentRegistry) => void]>([
      ['one extension provides', (registry) => void provide(registry, 'acme.jira')],
      [
        'two extensions provide',
        (registry) => {
          provide(registry, 'acme.jira')
          provide(registry, 'acme.compact')
        },
      ],
    ])('never selects what an extension provides: %s, and core’s default renders', (_label, extensions) => {
      const registry = servedRegistry()
      extensions(registry)
      registerDefault(registry)

      const result = resolved(resolveComponent(registry, Header))

      expect(registry.listUsable(Header)[0]?.extensionId).toBe('acme.jira')
      expect(result.component.componentId).toBe(DEFAULT_ID)
      expect(result.source).toBe('default')
    })
  })

  describe('with a preference that can render', () => {
    it('renders a preferred, usable extension implementation, with core’s default as the fallback', () => {
      const registry = populated()

      const result = resolveComponent(registry, Header, JIRA_ID)

      expect(result).toEqual({
        status: 'resolved',
        component: registry.get(JIRA_ID),
        fallback: registry.get(DEFAULT_ID),
        source: 'preference',
      })
      expect(resolved(result).component).toBe(registry.get(JIRA_ID))
      expect(resolved(result).fallback).toBe(registry.get(DEFAULT_ID))
    })

    it('renders the other extension’s implementation when that is the one chosen', () => {
      const registry = populated()

      expect(resolved(resolveComponent(registry, Header, ACME_COMPACT_ID)).component).toBe(registry.get(ACME_COMPACT_ID))
    })

    it.each<[string, string]>([
      ['compact implementation', COMPACT_ID],
      ['default itself', DEFAULT_ID],
    ])('honours a preference for core’s %s', (_label, preference) => {
      const registry = populated()

      const result = resolved(resolveComponent(registry, Header, preference))

      expect(result.source).toBe('preference')
      expect(result.component).toBe(registry.get(preference))
      expect(result.fallback).toBe(registry.get(DEFAULT_ID))
    })

    it('gives the same object as component and fallback when the preference is core’s default', () => {
      const result = resolved(resolveComponent(populated(), Header, DEFAULT_ID))

      expect(result.component).toBe(result.fallback)
    })
  })

  describe('with a preference it sets aside', () => {
    it('sets aside an id nobody registered as not-found, and renders core’s default', () => {
      const registry = populated()

      expect(resolveComponent(registry, Header, GONE_ID)).toEqual({
        status: 'resolved',
        component: registry.get(DEFAULT_ID),
        fallback: registry.get(DEFAULT_ID),
        source: 'default',
        rejected: { reason: 'not-found', componentId: GONE_ID },
      })
    })

    it.each<[string, (provided: ReturnType<typeof provide>) => void]>([
      ['its handle is disposed', (provided) => provided.handle.dispose()],
      ['its extension’s scope ends', (provided) => provided.end()],
    ])('sets aside a registration that was removed (%s) as not-found, with the same fallback', (_label, remove) => {
      const registry = servedRegistry()
      registerDefault(registry)
      const jira = provide(registry, 'acme.jira')
      const before = resolved(resolveComponent(registry, Header, JIRA_ID))

      remove(jira)
      const after = resolveComponent(registry, Header, JIRA_ID)

      expect(before.source).toBe('preference')
      expect(rejectionOf(after)).toEqual({ reason: 'not-found', componentId: JIRA_ID })
      expect(resolved(after).component).toBe(before.fallback)
      expect(resolved(after).fallback).toBe(before.fallback)
    })

    it('sets aside an implementation of another served contract as other-contract, naming that contract', () => {
      const registry = populated()
      provideJiraList(registry)

      const result = resolveComponent(registry, Header, JIRA_LIST_ID)

      expect(rejectionOf(result)).toEqual({
        reason: 'other-contract',
        componentId: JIRA_LIST_ID,
        contractId: 'cezar.fixture.task-list',
      })
      expect(resolved(result).component).toBe(registry.get(DEFAULT_ID))
    })

    it.each<[string, ComponentContract<HeaderProps>, readonly string[], Record<string, unknown>]>([
      [
        'built for @2',
        HeaderV2,
        ['shows-title'],
        {
          code: 'contract-version-mismatch',
          message: 'acme.jira.task-header implements cezar.fixture.task-header@2, but this Cezar serves cezar.fixture.task-header@1',
          expected: 1,
          actual: 2,
        },
      ],
      [
        'missing shows-title',
        Header,
        ['compact'],
        {
          code: 'missing-capability',
          message: 'acme.jira.task-header does not declare "shows-title", required by cezar.fixture.task-header@1',
          capability: 'shows-title',
        },
      ],
    ])('sets aside an extension %s as incompatible, with the registration’s own issues', (_label, contract, capabilities, issue) => {
      const registry = servedRegistry()
      registerDefault(registry)
      provide(registry, 'acme.jira', contract, capabilities)

      const result = resolveComponent(registry, Header, JIRA_ID)
      const rejected = rejectionOf(result)

      expect(rejected).toEqual({ reason: 'incompatible', componentId: JIRA_ID, issues: [issue] })
      if (rejected.reason !== 'incompatible') throw new Error('expected incompatible')
      expect(rejected.issues).toBe(registry.get(JIRA_ID)?.issues)
      expect(resolved(result).component).toBe(registry.get(DEFAULT_ID))
    })

    it.each<[string, unknown]>([
      ['a number', 42],
      ['an object', {}],
      ['an empty string', ''],
      ['a malformed id', 'Not An Id'],
      ['an id over 128 characters', `acme.${'a'.repeat(124)}`],
      ['a revoked proxy', revoked()],
    ])('sets aside %s as invalid, never echoing it and never throwing', (_label, preference) => {
      const registry = populated()

      let result: ComponentResolution<HeaderProps> | undefined
      expect(() => {
        result = resolveComponent(registry, Header, preference as string)
      }).not.toThrow()

      const rejected = rejectionOf(result as ComponentResolution<HeaderProps>)
      expect(rejected).toEqual({ reason: 'invalid' })
      expect(Object.keys(rejected)).toEqual(['reason'])
      expect(resolved(result as ComponentResolution<HeaderProps>).component).toBe(registry.get(DEFAULT_ID))
    })

    it('gives not-found, never incompatible with no issues, for a compatible registration that is not a candidate', () => {
      const registry = populated()
      // Only a fake can do this: the cockpit's registry lists every compatible registration of the contract.
      const fake: ResolverRegistry = {
        listUsable: (contract) =>
          Object.freeze(registry.listUsable(contract).filter((candidate) => candidate.componentId !== JIRA_ID)),
        get: (componentId) => registry.get(componentId),
      }

      expect(fake.get(JIRA_ID)?.compatible).toBe(true)
      expect(rejectionOf(resolveComponent(fake, Header, JIRA_ID))).toEqual({ reason: 'not-found', componentId: JIRA_ID })
    })
  })

  describe('unresolved', () => {
    it.each<[string, (registry: CockpitComponentRegistry) => void, unknown, unknown]>([
      ['core registered only its compact implementation', (registry) => void registerCompact(registry), Header, undefined],
      [
        'only extensions registered, even with a preference for one',
        (registry) => {
          provide(registry, 'acme.jira')
          provide(registry, 'acme.compact')
        },
        Header,
        JIRA_ID,
      ],
      ['the token is at another major', (registry) => void registerDefault(registry), HeaderV2, DEFAULT_ID],
      [
        'the token is malformed',
        (registry) => void registerDefault(registry),
        { kind: 'event', id: 'cezar.fixture.task-header', version: 1 },
        undefined,
      ],
      ['the token is null', (registry) => void registerDefault(registry), null, undefined],
      ['the token is a revoked proxy', (registry) => void registerDefault(registry), revoked(), JIRA_ID],
    ])('leaves the contract unresolved when %s', (_label, populate, contract, preference) => {
      const registry = servedRegistry()
      populate(registry)

      let result: ComponentResolution<HeaderProps> | undefined
      expect(() => {
        result = resolveComponent(registry, contract as typeof Header, preference as string | undefined)
      }).not.toThrow()

      expect(result).toEqual({ status: 'unresolved' })
    })

    it('never takes an extension’s .default as the fallback, even a built-in’s under cezar.', () => {
      const registry = servedRegistry()
      registry.forExtension(fakeScope('cezar.fixture').scope).provide(Header, header(DEFAULT_ID, 'Built-in header'))
      provide(registry, 'acme.jira')

      expect(registry.listUsable(Header).map((candidate) => [candidate.componentId, candidate.extensionId])).toEqual([
        [DEFAULT_ID, 'cezar.fixture'],
        [JIRA_ID, 'acme.jira'],
      ])
      expect(resolveComponent(registry, Header)).toEqual({ status: 'unresolved' })
      expect(resolveComponent(registry, Header, JIRA_ID)).toEqual({ status: 'unresolved' })
    })
  })

  describe('determinism and purity', () => {
    /** Every kind of preference the cases above use. */
    const PREFERENCES: readonly unknown[] = [
      undefined,
      null,
      JIRA_ID,
      ACME_COMPACT_ID,
      COMPACT_ID,
      DEFAULT_ID,
      GONE_ID,
      JIRA_LIST_ID,
      'acme.v2.task-header',
      'acme.untitled.task-header',
      42,
      'Not An Id',
    ]

    /** Every registration those preferences name, in an order the caller picks. */
    const STEPS: readonly ((registry: CockpitComponentRegistry) => void)[] = [
      (registry) => void registerDefault(registry),
      (registry) => void registerCompact(registry),
      (registry) => void provide(registry, 'acme.jira'),
      (registry) => void provide(registry, 'acme.compact'),
      (registry) => void provide(registry, 'acme.v2', HeaderV2),
      (registry) => void provide(registry, 'acme.untitled', Header, ['compact']),
      (registry) => void provideJiraList(registry),
    ]

    const build = (steps: readonly ((registry: CockpitComponentRegistry) => void)[]) => {
      const registry = servedRegistry()
      for (const step of steps) step(registry)
      return registry
    }

    it('gives equal results for the same call, as a new object each time', () => {
      const registry = build(STEPS)

      for (const preference of PREFERENCES) {
        const first = resolveComponent(registry, Header, preference as string)
        const second = resolveComponent(registry, Header, preference as string)

        expect(second).toEqual(first)
        expect(second).not.toBe(first)
      }
    })

    it('does not depend on the order implementations registered in', () => {
      const forward = build(STEPS)
      const backward = build([...STEPS].reverse())
      const ids = (registry: CockpitComponentRegistry) =>
        registry.list(Header.id).map((registration) => registration.componentId)

      expect(ids(backward)).toEqual([...ids(forward)].reverse())
      for (const preference of PREFERENCES) {
        expect(resolveComponent(backward, Header, preference as string)).toEqual(
          resolveComponent(forward, Header, preference as string),
        )
      }
    })

    it('freezes the result and its rejection', () => {
      const registry = build(STEPS)

      const preferred = resolveComponent(registry, Header, JIRA_ID)
      const setAside = resolveComponent(registry, Header, GONE_ID)
      const unresolved = resolveComponent(servedRegistry(), Header)

      expect(Object.isFrozen(preferred)).toBe(true)
      expect(Object.isFrozen(setAside)).toBe(true)
      expect(Object.isFrozen(rejectionOf(setAside))).toBe(true)
      expect(Object.isFrozen(unresolved)).toBe(true)
    })

    it('reads the registry through listUsable and get only, and writes nothing to the console', () => {
      const registry = build(STEPS)
      const reads = new Set<string>()
      const watched = new Proxy(registry, {
        get(target, key, receiver) {
          reads.add(String(key))
          return Reflect.get(target, key, receiver)
        },
      })
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => {}),
      )

      for (const preference of PREFERENCES) resolveComponent(watched, Header, preference as string)

      expect([...reads].sort()).toEqual(['get', 'listUsable'])
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    })
  })

  it('types the resolved component with its contract’s props, and makes callers narrow', () => {
    const resolution = resolveComponent(populated(), Header, JIRA_ID)

    const typeOnly = () => {
      // @ts-expect-error — an unresolved result has no component: narrow on status first
      void resolution.component
      if (resolution.status !== 'resolved') return
      renderWith(resolution.component.component, { title: 'Fix the flaky test' })
      renderWith(resolution.fallback.component, { title: 'Fix the flaky test' })
      // @ts-expect-error — the contract's props, never another contract's
      renderWith(resolution.component.component, { runIds: [] })
      // @ts-expect-error — only a set-aside preference has a rejection: narrow on source first
      void resolution.rejected
      expectTypeOf(resolution.component).toEqualTypeOf<UsableComponent<HeaderProps>>()
      if (resolution.source === 'default') expectTypeOf(resolution.rejected).toEqualTypeOf<PreferenceRejection | undefined>()
    }

    expectTypeOf(typeOnly).toBeFunction()
    expect(resolved(resolution).component.componentId).toBe(JIRA_ID)
  })
})

describe('missingCoreDefaults', () => {
  /** A third served contract, which nothing implements. */
  const Status = defineComponentContract<HeaderProps>('cezar.fixture.task-status', { version: 1 })

  const registerListDefault = (registry: CockpitComponentRegistry) =>
    registry.register(TaskList, { id: 'cezar.fixture.task-list.default', title: 'Task list', component: RenderList })

  it('is [] when every contract of the catalog has core’s default registered', () => {
    const registry = servedRegistry()
    registerDefault(registry)
    registerListDefault(registry)
    provide(registry, 'acme.jira')

    expect(missingCoreDefaults(registry, [Header, TaskList])).toEqual([])
  })

  it('names, in catalog order, each contract left unresolved: only a compact core implementation, or nothing', () => {
    const catalog: readonly AnyComponentContract[] = [Status, TaskList, Header]
    const registry = createComponentRegistry({ contracts: catalog, onDiagnostic: () => {} })
    registerCompact(registry)
    registerListDefault(registry)
    provide(registry, 'acme.jira')

    const missing = missingCoreDefaults(registry, catalog)

    expect(missing).toEqual(['cezar.fixture.task-status', 'cezar.fixture.task-header'])
    expect(Object.isFrozen(missing)).toBe(true)
    for (const contract of catalog) {
      expect(missing.includes(contract.id)).toBe(resolveComponent(registry, contract).status === 'unresolved')
    }
  })

  it('names a contract whose .default an extension provides, since only core’s counts', () => {
    const registry = servedRegistry()
    registry.forExtension(fakeScope('cezar.fixture').scope).provide(Header, header(DEFAULT_ID, 'Built-in header'))

    expect(missingCoreDefaults(registry, [Header])).toEqual([Header.id])
  })

  it('is [] for an empty catalog', () => {
    expect(missingCoreDefaults(servedRegistry(), [])).toEqual([])
  })
})
