import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  defineComponentContract,
  type ComponentImplementation,
  type ContributionId,
} from '@open-mercato/cezar-extension-api'

import { fakeScope } from '../extensions/registry.fixtures'
import { createComponentRegistry, type AnyComponentContract, type CockpitComponentRegistry } from './registry'
import {
  ComponentPreferenceError,
  createComponentPreferences,
  type ComponentPreferencesStorage,
} from './preferences'

interface HeaderProps {
  readonly title: string
}

const Header = defineComponentContract<HeaderProps>('cezar.fixture.task-header', {
  version: 1,
  requiredCapabilities: ['shows-title'],
})
const HeaderV2 = defineComponentContract<HeaderProps>('cezar.fixture.task-header', { version: 2 })
const TaskList = defineComponentContract<{ readonly runIds: readonly string[] }>('cezar.fixture.task-list', { version: 1 })
const Render: ComponentType<HeaderProps> = () => null
const RenderList: ComponentType<{ readonly runIds: readonly string[] }> = () => null

const DEFAULT_ID = 'cezar.fixture.task-header.default'
const COMPACT_ID = 'cezar.fixture.task-header.compact'
const JIRA_ID = 'acme.jira.task-header'
const JIRA_LIST_ID = 'acme.jira.task-list'
const VERSIONED_ID = 'acme.versioned.task-header'
const MISFIT_ID = 'acme.misfit.task-header'
const GONE_ID = 'acme.gone.task-header'

const header = (
  id: string,
  title: string,
  capabilities: readonly string[] = ['shows-title'],
): ComponentImplementation<HeaderProps> => ({ id, title, capabilities, component: Render })

function registryWithFixtures(): CockpitComponentRegistry {
  const registry = createComponentRegistry({ contracts: [Header, TaskList], onDiagnostic: () => {} })
  registry.register(Header, header(DEFAULT_ID, 'Task header'))
  registry.register(Header, header(COMPACT_ID, 'Compact header'))
  registry.register(
    TaskList,
    { id: 'cezar.fixture.task-list.default', title: 'Task list', component: RenderList } as ComponentImplementation<
      { readonly runIds: readonly string[] }
    >,
  )
  registry.forExtension(fakeScope('acme.jira').scope).provide(Header, header(JIRA_ID, 'Jira header'))
  registry.forExtension(fakeScope('acme.jira').scope).provide(TaskList, {
    id: JIRA_LIST_ID,
    title: 'Jira list',
    component: RenderList,
  } as ComponentImplementation<{ readonly runIds: readonly string[] }>)
  registry.forExtension(fakeScope('acme.versioned').scope).provide(HeaderV2, {
    id: VERSIONED_ID,
    title: 'Versioned header',
    component: Render,
  } as ComponentImplementation<HeaderProps>)
  registry.forExtension(fakeScope('acme.misfit').scope).provide(Header, {
    id: MISFIT_ID,
    title: 'Misfit header',
    component: Render,
    capabilities: [],
  } as ComponentImplementation<HeaderProps>)
  return registry
}

function storage(initial: unknown, save: (value: Record<string, unknown>) => Promise<void> = async () => {}) {
  const saved: Record<string, unknown>[] = []
  const result: ComponentPreferencesStorage & { readonly saved: readonly Record<string, unknown>[] } = {
    async load() {
      return initial
    },
    async save(value) {
      saved.push(value)
      await save(value)
    },
    saved,
  }
  return result
}

function preferences(
  initial: unknown = {},
  overrides: Partial<{ registry: CockpitComponentRegistry; contracts: readonly AnyComponentContract[] }> = {},
) {
  const store = storage(initial)
  const service = createComponentPreferences({
    registry: overrides.registry ?? registryWithFixtures(),
    contracts: overrides.contracts ?? [Header, TaskList],
    storage: store,
  })
  return { service, store }
}

async function rejected(promise: Promise<void>): Promise<ComponentPreferenceError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ComponentPreferenceError)
    return error as ComponentPreferenceError
  }
  throw new Error('expected component preference operation to reject')
}

describe('componentPreferences', () => {
  it('hydrates valid entries, keeps unknown siblings and reports hydration once', async () => {
    const { service } = preferences({
      settings: { compact: true },
      implementations: { [Header.id]: JIRA_ID, 'cezar.future.contract': 'acme.future.implementation', bad: 7 },
    })
    const changes: unknown[] = []
    service.subscribe((change) => changes.push(change))

    await service.ready

    expect(service.get(Header.id)).toBe(JIRA_ID)
    expect(service.get('cezar.future.contract')).toBe('acme.future.implementation')
    expect(service.get(TaskList.id)).toBeUndefined()
    expect(changes).toEqual([{ changed: [Header.id, 'cezar.future.contract'], reason: 'hydrated' }])
    expect(service.revision()).toBe(1)
  })

  it.each([
    undefined,
    5,
    { implementations: 5 },
    { implementations: { [Header.id]: 7, bad: JIRA_ID } },
  ])('hydrates malformed input as an empty snapshot: %j', async (initial) => {
    const { service } = preferences(initial)
    await service.ready
    expect(service.get(Header.id)).toBeUndefined()
  })

  it('keeps a failed hydration unwritable', async () => {
    const store = storage(undefined)
    const service = createComponentPreferences({ registry: registryWithFixtures(), contracts: [Header, TaskList], storage: store })
    await service.ready

    const error = await rejected(service.set(Header.id, JIRA_ID))
    expect(error.code).toBe('not-ready')
    await expect(service.reset(Header.id)).rejects.toMatchObject({ code: 'not-ready' })
    expect(store.saved).toEqual([])
  })

  it('sets a compatible extension, preserves unknown data, and notifies once', async () => {
    const { service, store } = preferences({
      settings: { compact: true },
      implementations: { 'cezar.future.contract': 'acme.future.implementation' },
    })
    await service.ready
    const changes: unknown[] = []
    service.subscribe((change) => changes.push(change))

    await service.set(Header.id, JIRA_ID)

    expect(service.get(Header.id)).toBe(JIRA_ID)
    expect(store.saved).toEqual([
      {
        settings: { compact: true },
        implementations: {
          'cezar.future.contract': 'acme.future.implementation',
          [Header.id]: JIRA_ID,
        },
      },
    ])
    expect(changes).toEqual([{ changed: [Header.id], reason: 'set' }])
    expect(service.revision()).toBe(2)
  })

  it('accepts a non-default core implementation', async () => {
    const { service } = preferences()
    await service.ready
    await service.set(Header.id, COMPACT_ID)
    expect(service.get(Header.id)).toBe(COMPACT_ID)
  })

  it.each([
    ['invalid', '' as ContributionId, JIRA_ID],
    ['invalid', 'Not An Id' as ContributionId, JIRA_ID],
    ['unknown-contract', 'cezar.not-served' as ContributionId, JIRA_ID],
    ['is-default', Header.id, DEFAULT_ID],
    ['not-found', Header.id, GONE_ID],
    ['other-contract', Header.id, JIRA_LIST_ID],
    ['incompatible', Header.id, VERSIONED_ID],
    ['incompatible', Header.id, MISFIT_ID],
  ])('rejects a %s choice without writing', async (code, contractId, componentId) => {
    const { service, store } = preferences()
    await service.ready

    const error = await rejected(service.set(contractId, componentId))

    expect(error.code).toBe(code)
    expect(store.saved).toEqual([])
  })

  it('reset removes a choice, writes once, and does nothing when already reset', async () => {
    const { service, store } = preferences({ implementations: { [Header.id]: JIRA_ID } })
    await service.ready

    await service.reset(Header.id)
    await service.reset(Header.id)

    expect(service.get(Header.id)).toBeUndefined()
    expect(store.saved).toEqual([{ implementations: {} }])
  })

  it('rolls back a failed write and reports the original cause', async () => {
    const cause = new Error('read-only')
    const store = storage({ implementations: { [Header.id]: JIRA_ID } }, async () => {
      throw cause
    })
    const service = createComponentPreferences({ registry: registryWithFixtures(), contracts: [Header, TaskList], storage: store })
    await service.ready
    const changes: unknown[] = []
    service.subscribe((change) => changes.push(change))

    const error = await rejected(service.set(Header.id, COMPACT_ID))

    expect(error.code).toBe('write-failed')
    expect(error.cause).toBe(cause)
    expect(service.get(Header.id)).toBe(JIRA_ID)
    expect(changes).toEqual([
      { changed: [Header.id], reason: 'set' },
      { changed: [Header.id], reason: 'write-failed' },
    ])
  })

  it('serializes rapid writes from the current snapshot', async () => {
    const { service, store } = preferences()
    await service.ready
    const first = service.set(Header.id, JIRA_ID)
    const second = service.set(TaskList.id, JIRA_LIST_ID)

    await Promise.all([first, second])

    expect(store.saved.at(-1)).toEqual({ implementations: { [Header.id]: JIRA_ID, [TaskList.id]: JIRA_LIST_ID } })
  })

  it('supports unsubscribe and contains throwing listeners', async () => {
    const { service } = preferences()
    await service.ready
    const received: string[] = []
    const unsubscribe = service.subscribe(() => {
      throw new Error('listener failed')
    })
    service.subscribe((change) => received.push(change.reason))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await service.set(Header.id, JIRA_ID)
    unsubscribe()
    await service.reset(Header.id)

    expect(received).toEqual(['set', 'reset'])
    expect(error).toHaveBeenCalledOnce()
  })

  it('uses the same contribution id bound as the contract', async () => {
    const valid = `a.${'a'.repeat(126)}`
    const invalid = `a.${'a'.repeat(127)}`
    const { service } = preferences()
    await service.ready

    expect(() => service.get(valid)).not.toThrow()
    expect(() => service.get(invalid)).not.toThrow()
    await expect(service.set(invalid, JIRA_ID)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('stays free of React, DOM, and module-level runtime state', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'packages/web/src/component-registry/preferences.ts'), 'utf8')
    expect(source).not.toMatch(/from ['"]react['"]|from ['"]react-dom['"]|\bdocument\b|\bwindow\b/)
    expect(source).toMatch(/from '@open-mercato\/cezar-extension-api'/)
    expect(source).toMatch(/from '\.\/resolve'/)
  })
})
