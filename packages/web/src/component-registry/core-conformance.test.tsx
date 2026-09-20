import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  defineComponentContract,
  type ComponentContract,
  type ComponentImplementation,
} from '@open-mercato/cezar-extension-api'

import { fakeScope } from '../extensions/registry.fixtures'
import { ComponentHost } from './component-host'
import { createCoreComponentRegistry } from './core-components'
import { CORE_COMPONENT_CONTRACTS } from './core-contracts'
import { CORE_CONFORMANCE_FIXTURES, type CoreConformanceFixture } from './core-conformance-fixtures'
import { ComponentsProvider } from './provider'
import type { AnyComponentContract } from './registry'

afterEach(cleanup)

function fixtureFor(contract: AnyComponentContract, fixtures: readonly CoreConformanceFixture[] = CORE_CONFORMANCE_FIXTURES): CoreConformanceFixture {
  const fixture = fixtures.find((candidate) => candidate.contract.id === contract.id && candidate.contract.version === contract.version)
  if (fixture === undefined) throw new Error(`Missing core conformance fixture for ${contract.id}@${contract.version}`)
  return fixture
}

function renderHost(fixture: CoreConformanceFixture, options: {
  readonly registry?: ReturnType<typeof createCoreComponentRegistry>
  readonly preferenceOf?: (id: string) => string | null
  readonly onImplementationError?: (failure: unknown) => void
} = {}) {
  const registry = options.registry ?? createCoreComponentRegistry()
  return {
    registry,
    ...render(
      <ComponentsProvider
        registry={registry}
        preferenceOf={options.preferenceOf}
        onImplementationError={options.onImplementationError}
      >
        <ComponentHost
          contract={fixture.contract as ComponentContract<object>}
          subject="r1"
          props={fixture.props}
        />
      </ComponentsProvider>,
    ),
  }
}

describe('core component conformance', () => {
  it.each(CORE_COMPONENT_CONTRACTS.map((contract) => [contract.id, contract] as const))(
    'has a fixture and renders the registered default for %s', (_id, contract) => {
      const fixture = fixtureFor(contract)
      const { container } = renderHost(fixture)
      const host = container.querySelector<HTMLElement>('[data-slot="component-host"]')

      expect(host?.dataset.component).toBe(`${contract.id}.default`)
      expect(host?.style.minBlockSize).toBe(`${contract.layout?.minBlockSize}px`)
    },
  )

  it('names a served contract without a fixture', () => {
    const extra = defineComponentContract<object>('cezar.test.extra', {
      version: 1,
      requiredCapabilities: [],
      optionalCapabilities: [],
      layout: { minBlockSize: 20 },
    })

    expect(() => fixtureFor(extra, [...CORE_CONFORMANCE_FIXTURES])).toThrow('cezar.test.extra@1')
  })

  it.each(CORE_COMPONENT_CONTRACTS.map((contract) => [contract.id, contract] as const))(
    'falls back independently when the preferred %s implementation throws', async (_id, contract) => {
      const fixture = fixtureFor(contract)
      const diagnostics = vi.fn()
      const registry = createCoreComponentRegistry()
      const implementation: ComponentImplementation<object> = {
        id: `test.throwing.${contract.id.replaceAll('.', '-')}`,
        title: 'Throwing implementation',
         capabilities: [...(contract.requiredCapabilities ?? [])],
        component: () => {
          throw new Error('implementation failed')
        },
      }
      registry.forExtension(fakeScope('test.throwing').scope).provide(
        contract as ComponentContract<object>,
        implementation,
      )

      const { container } = renderHost(fixture, {
        registry,
        preferenceOf: (id) => (id === contract.id ? implementation.id : null),
        onImplementationError: diagnostics,
      })

       await waitFor(() => expect(container.querySelector<HTMLElement>('[data-slot="component-host"]')?.dataset.component).toBe(`${contract.id}.default`))
      expect(diagnostics).toHaveBeenCalledTimes(1)
    },
  )

  it.each(CORE_COMPONENT_CONTRACTS.map((contract) => [contract.id, contract] as const))(
    'does not render an incompatible preferred implementation for %s', (_id, contract) => {
      const fixture = fixtureFor(contract)
      const registry = createCoreComponentRegistry()
      const implementation: ComponentImplementation<object> = {
        id: `test.incompatible.${contract.id.replaceAll('.', '-')}`,
        title: 'Incompatible implementation',
         capabilities: [...(contract.requiredCapabilities ?? [])],
        component: () => null,
      }
      const future = defineComponentContract<object>(contract.id, {
        version: contract.version + 1,
         requiredCapabilities: [...(contract.requiredCapabilities ?? [])],
         optionalCapabilities: [...(contract.optionalCapabilities ?? [])],
        layout: contract.layout,
      })
      registry.forExtension(fakeScope('test.incompatible').scope).provide(future, implementation)

      const { container } = renderHost(fixture, {
        registry,
        preferenceOf: (id) => (id === contract.id ? implementation.id : null),
      })

       expect(container.querySelector<HTMLElement>('[data-slot="component-host"]')?.dataset.component).toBe(`${contract.id}.default`)
      expect(registry.get(implementation.id)?.compatible).toBe(false)
    },
  )

  it.each(CORE_COMPONENT_CONTRACTS.map((contract) => [contract.id, contract] as const))(
    'returns to core when the preferred %s implementation is disposed', async (_id, contract) => {
      const fixture = fixtureFor(contract)
      const registry = createCoreComponentRegistry()
      const implementation: ComponentImplementation<object> = {
        id: `test.disposable.${contract.id.replaceAll('.', '-')}`,
        title: 'Disposable implementation',
         capabilities: [...(contract.requiredCapabilities ?? [])],
        component: () => null,
      }
      const handle = registry.forExtension(fakeScope('test.disposable').scope).provide(
        contract as ComponentContract<object>,
        implementation,
      )
      const { container } = renderHost(fixture, {
        registry,
        preferenceOf: (id) => (id === contract.id ? implementation.id : null),
      })

       expect(container.querySelector<HTMLElement>('[data-slot="component-host"]')?.dataset.component).toBe(implementation.id)
      handle.dispose()
       await waitFor(() => expect(container.querySelector<HTMLElement>('[data-slot="component-host"]')?.dataset.component).toBe(`${contract.id}.default`))
    },
  )
})
