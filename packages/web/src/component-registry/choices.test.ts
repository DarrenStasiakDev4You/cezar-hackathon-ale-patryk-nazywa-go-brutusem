import type { ComponentType } from 'react'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
  defineComponentContract,
  type ComponentContract,
  type ComponentImplementation,
} from '@open-mercato/cezar-extension-api'

import { fakeScope } from '../extensions/registry.fixtures'
import { listComponentChoices, type ChoicesRegistry } from './choices'
import { createComponentRegistry, type CockpitComponentRegistry } from './registry'
import { resolveComponent } from './resolve'

interface HeaderProps {
  readonly title: string
}

const Header = defineComponentContract<HeaderProps>('cezar.fixture.choices', {
  version: 1,
  requiredCapabilities: ['shows-title'],
})
const HeaderV2 = defineComponentContract<HeaderProps>('cezar.fixture.choices', { version: 2 })
const Render: ComponentType<HeaderProps> = () => null

const DEFAULT = 'cezar.fixture.choices.default'
const COMPACT = 'cezar.fixture.choices.compact'
const JIRA = 'acme.jira.choices'
const PARTIAL = 'acme.partial.choices'
const V2 = 'acme.version.choices'

const implementation = (id: string, capabilities: readonly string[] = ['shows-title']): ComponentImplementation<HeaderProps> => ({
  id,
  title: id,
  capabilities,
  component: Render,
})

function registryWithAllImplementations(): CockpitComponentRegistry {
  const registry = createComponentRegistry({ contracts: [Header], onDiagnostic: () => {} })
  registry.register(Header, implementation(DEFAULT))
  registry.register(Header, implementation(COMPACT))
  registry.forExtension(fakeScope('acme.jira').scope).provide(Header, implementation(JIRA, ['shows-title', 'jira.issue.create']))
  registry.forExtension(fakeScope('acme.partial').scope).provide(Header, implementation(PARTIAL, []))
  registry.forExtension(fakeScope('acme.version').scope).provide(HeaderV2, implementation(V2))
  return registry
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('listComponentChoices', () => {
  it('groups the default, usable overrides and unavailable registrations deterministically', () => {
    const registry = registryWithAllImplementations()
    const choices = listComponentChoices(registry, Header)

    expect(choices.status).toBe('resolved')
    if (choices.status !== 'resolved') throw new Error('expected resolved choices')
    expect(choices.default.componentId).toBe(DEFAULT)
    expect(choices.overrides.map((entry) => entry.componentId)).toEqual([JIRA, COMPACT])
    expect(choices.overrides[0]?.customCapabilities).toEqual(['jira.issue.create'])
    expect(choices.unavailable.map((entry) => entry.componentId)).toEqual([PARTIAL, V2])
    expect(choices.unavailable[0]?.missingCapabilities).toEqual(['shows-title'])
    expect(choices.unavailable[1]?.missingCapabilities).toEqual([])
  })

  it('agrees with the resolver for every offered and unavailable implementation', () => {
    const registry = registryWithAllImplementations()
    const choices = listComponentChoices(registry, Header)
    if (choices.status !== 'resolved') throw new Error('expected resolved choices')

    for (const entry of [choices.default, ...choices.overrides]) {
      const result = resolveComponent(registry, Header, entry.componentId)
      expect(result.status).toBe('resolved')
      if (result.status !== 'resolved') continue
      expect(result.source).toBe('preference')
      expect(result.component).toBe(entry)
    }
    for (const entry of choices.unavailable) {
      const result = resolveComponent(registry, Header, entry.componentId)
      expect(result.status).toBe('resolved')
      if (result.status !== 'resolved' || result.source !== 'default') continue
      expect(result.rejected).toEqual({ reason: 'incompatible', componentId: entry.componentId, issues: entry.issues })
      expect(registry.get(entry.componentId)).toBe(entry)
    }
  })

  it('returns the same groups regardless of registration order and reflects disposal', () => {
    const first = registryWithAllImplementations()
    const second = createComponentRegistry({ contracts: [Header], onDiagnostic: () => {} })
    const registrations = [
      [V2, HeaderV2, ['shows-title']],
      [PARTIAL, Header, []],
      [JIRA, Header, ['shows-title', 'jira.issue.create']],
    ] as const
    second.register(Header, implementation(DEFAULT))
    second.register(Header, implementation(COMPACT))
    for (const [id, contract, capabilities] of [...registrations].reverse()) {
      second.forExtension(fakeScope(id.replace(/\.choices$/, '')).scope).provide(contract, implementation(id, capabilities))
    }

    expect(listComponentChoices(first, Header)).toEqual(listComponentChoices(second, Header))

    const partial = first.get(PARTIAL)
    expect(partial).toBeDefined()
    // The registration's provider scope owns the disposable in this fixture, so a direct registry
    // fake is not needed to prove the read model observes removal.
    const withoutPartial: ChoicesRegistry = {
      listUsable: (contract) => first.listUsable(contract),
      list: (contractId) => first.list(contractId).filter((entry) => entry !== partial),
      get: (componentId) => first.get(componentId),
    }
    expect(listComponentChoices(withoutPartial, Header)).toMatchObject({
      status: 'resolved',
      unavailable: [first.get(V2)],
    })
  })

  it('returns unresolved without a core default and reads only the registry seam', () => {
    const registry = createComponentRegistry({ contracts: [Header], onDiagnostic: () => {} })
    const reads: string[] = []
    const fake: ChoicesRegistry = {
      listUsable: (contract) => {
        reads.push('listUsable')
        return registry.listUsable(contract)
      },
      list: (contractId) => {
        reads.push('list')
        return registry.list(contractId)
      },
      get: (componentId) => {
        reads.push('get')
        return registry.get(componentId)
      },
    }

    expect(listComponentChoices(fake, Header)).toEqual({ status: 'unresolved' })
    expect(reads).toEqual(['listUsable'])
    expectTypeOf(listComponentChoices(registry, Header)).toMatchTypeOf<
      | { readonly status: 'unresolved' }
      | { readonly status: 'resolved'; readonly overrides: readonly { readonly component: ComponentType<HeaderProps> }[] }
    >()
  })
})
