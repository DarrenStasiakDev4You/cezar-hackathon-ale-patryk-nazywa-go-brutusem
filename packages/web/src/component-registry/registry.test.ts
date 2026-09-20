import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ComponentType } from 'react'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
  defineComponentContract,
  isExtensionError,
  type ComponentImplementation,
} from '@open-mercato/cezar-extension-api'

import { fakeScope } from '../extensions/registry.fixtures'
import { CORE_COMPONENT_CONTRACTS } from './core-contracts'
import {
  ComponentError,
  createComponentRegistry,
  logComponentDiagnostic,
  type AnyComponentContract,
  type ComponentRegistration,
} from './registry'

afterEach(() => {
  vi.restoreAllMocks()
})

interface HeaderProps {
  readonly title: string
}

/** The brief's `task.header@1`, as a fixture contract: nothing in production serves it. */
const Header = defineComponentContract<HeaderProps>('cezar.fixture.task-header', {
  version: 1,
  requiredCapabilities: ['shows-title'],
  optionalCapabilities: ['shows-status', 'compact'],
})

const HeaderV2 = defineComponentContract<HeaderProps>('cezar.fixture.task-header', { version: 2 })

const CoreHeader: ComponentType<HeaderProps> = () => null

/** Core's default: declares an optional capability first, a repeat and a name the contract ignores. */
const coreDefault: ComponentImplementation<HeaderProps> = {
  id: 'cezar.fixture.task-header.default',
  title: 'Task header',
  description: 'Core’s own header',
  capabilities: ['shows-status', 'shows-title', 'not-in-the-contract', 'shows-title'],
  component: CoreHeader,
}

const coreCompact: ComponentImplementation<HeaderProps> = {
  id: 'cezar.fixture.task-header.compact',
  title: 'Compact header',
  capabilities: ['shows-title'],
  component: CoreHeader,
}

const declaredDefault: ComponentImplementation<HeaderProps> = {
  ...coreCompact,
  id: 'cezar.fixture.task-header.declared',
}

/** A registry that serves the fixture contract at major 1. */
const servedRegistry = (options: Parameters<typeof createComponentRegistry>[0] = {}) =>
  createComponentRegistry({ contracts: [Header], ...options })

/** Type-level only: renders nothing, but refuses props that do not fit the component. */
function renderWith<P>(component: ComponentType<P>, props: NoInfer<P>): void {
  void component
  void props
}

function thrown(run: () => unknown): ComponentError {
  try {
    run()
  } catch (error) {
    expect(isExtensionError(error)).toBe(true)
    return error as ComponentError
  }
  throw new Error('expected a throw')
}

/** A revoked proxy: every property read on it throws a TypeError. */
function revoked(): object {
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  return proxy
}

describe('createComponentRegistry and its catalog', () => {
  it('builds from the production catalog, so a bad core token fails the gate and not the boot', () => {
    expect(() => createComponentRegistry({ contracts: CORE_COMPONENT_CONTRACTS })).not.toThrow()
    expect(() => createComponentRegistry()).not.toThrow()
  })

  it('accepts a served fixture contract', () => {
    expect(() => createComponentRegistry({ contracts: [Header] })).not.toThrow()
  })

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'cezar.fixture.task-header'],
    ['a command token', { kind: 'command', id: 'cezar.fixture.task-header', version: 1 }],
    ['a malformed id', { kind: 'component', id: 'Not An Id', version: 1 }],
    ['a missing version', { kind: 'component', id: 'cezar.fixture.task-header' }],
    ['version 0', { kind: 'component', id: 'cezar.fixture.task-header', version: 0 }],
    ['a fractional version', { kind: 'component', id: 'cezar.fixture.task-header', version: 1.5 }],
    ['a string version', { kind: 'component', id: 'cezar.fixture.task-header', version: '1' }],
    [
      'a throwing getter',
      Object.defineProperty({ kind: 'component', version: 1 }, 'id', {
        get() {
          throw new Error('getter broke')
        },
      }),
    ],
    ['a revoked proxy', revoked()],
  ])('refuses %s in the catalog with invalid-id', (_label, entry) => {
    const error = thrown(() => createComponentRegistry({ contracts: [entry as AnyComponentContract] }))

    expect(error).toBeInstanceOf(ComponentError)
    expect(error.name).toBe('ComponentError')
    expect(error.code).toBe('invalid-id')
    expect(error.message).not.toContain('getter broke')
  })

  it('refuses a served contract outside cezar. with namespace-violation', () => {
    const Foreign = defineComponentContract<HeaderProps>('acme.jira.task-header', { version: 1 })

    const error = thrown(() => createComponentRegistry({ contracts: [Foreign] }))

    expect(error.code).toBe('namespace-violation')
    expect(error.message).toBe('Served component contract "acme.jira.task-header" must be under "cezar."')
  })

  it('refuses two majors of one contract id with duplicate-registration', () => {
    const HeaderV2 = defineComponentContract<HeaderProps>('cezar.fixture.task-header', { version: 2 })

    const error = thrown(() => createComponentRegistry({ contracts: [Header, HeaderV2] }))

    expect(error.code).toBe('duplicate-registration')
    expect(error.message).toBe(
      'Component contract "cezar.fixture.task-header" is served twice (@1 and @2): one major per id',
    )
  })

  it.each<[string, () => Parameters<typeof createComponentRegistry>[0]]>([
    ['a catalog that is not an array', () => ({ contracts: {} as unknown as AnyComponentContract[] })],
    ['a revoked proxy as the catalog', () => ({ contracts: revoked() as AnyComponentContract[] })],
    [
      'a catalog whose iterator throws',
      () => {
        const contracts = [Header]
        Object.defineProperty(contracts, Symbol.iterator, {
          value: () => {
            throw new Error('iterator broke')
          },
        })
        return { contracts }
      },
    ],
    [
      'options whose contracts getter throws',
      () =>
        Object.defineProperty({}, 'contracts', {
          get() {
            throw new Error('getter broke')
          },
        }),
    ],
  ])('refuses %s with invalid-input, never the raw error', (_label, options) => {
    const error = thrown(() => createComponentRegistry(options()))

    expect(error).toBeInstanceOf(ComponentError)
    expect(error.code).toBe('invalid-input')
    expect(error.message).toBe('options.contracts must be an array of component contracts')
  })

  it('refuses a served token whose capability lists the check cannot read, with invalid-id', () => {
    const handBuilt = { kind: 'component', id: 'cezar.fixture.task-header', version: 1, requiredCapabilities: 'shows-title' }

    const error = thrown(() => createComponentRegistry({ contracts: [handBuilt as unknown as AnyComponentContract] }))

    expect(error.code).toBe('invalid-id')
    expect(error.message).toBe(
      'Served component contract "cezar.fixture.task-header" is malformed: ' +
        'contract.requiredCapabilities must be an array of strings',
    )
  })
})

describe('ComponentError', () => {
  it('is recognised by isExtensionError, with its code and component id', () => {
    const error = new ComponentError('duplicate-registration', 'taken', { componentId: 'acme.jira.task-header' })

    expect(isExtensionError(error, 'duplicate-registration')).toBe(true)
    expect(error.componentId).toBe('acme.jira.task-header')
    expect(new ComponentError('invalid-id', 'malformed').componentId).toBeUndefined()
  })
})

describe('logComponentDiagnostic', () => {
  const registration = (extensionId: string | null): ComponentRegistration => ({
    componentId: 'acme.jira.task-header',
    extensionId,
    isDefault: false,
    contractId: 'cezar.fixture.task-header',
    contractVersion: 2,
    component: () => null,
    declaredCapabilities: [],
    capabilities: [],
    metadata: { title: 'Jira header' },
    compatible: false,
    issues: [
      {
        code: 'contract-version-mismatch',
        message: 'acme.jira.task-header implements cezar.fixture.task-header@2, but this Cezar serves cezar.fixture.task-header@1',
        expected: 1,
        actual: 2,
      },
      { code: 'missing-capability', message: 'second issue', capability: 'shows-title' },
    ],
  })

  it('writes one console.warn line naming the component, its provider and every issue', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    logComponentDiagnostic(registration('acme.jira'))

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]).toEqual([
      '[cezar:extensions] acme.jira.task-header (acme.jira) is not used: ' +
        'acme.jira.task-header implements cezar.fixture.task-header@2, but this Cezar serves cezar.fixture.task-header@1; ' +
        'second issue',
    ])
  })

  it('names core as the provider of a registration without an extension', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    logComponentDiagnostic(registration(null))

    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[cezar:extensions\] acme\.jira\.task-header \(core\) is not used: /)
  })
})

describe('core register', () => {
  it('refuses every contract while the catalog is empty, with invalid-input', () => {
    const error = thrown(() => createComponentRegistry().register(Header, coreDefault))

    expect(error.code).toBe('invalid-input')
    expect(error.componentId).toBe('cezar.fixture.task-header.default')
    expect(error.message).toBe(
      'Core component "cezar.fixture.task-header.default" implements cezar.fixture.task-header@1, which is not in options.contracts',
    )
  })

  it('records a registration with its provenance, its fit and its metadata', () => {
    const registry = servedRegistry()

    registry.register(Header, coreDefault)

    expect(registry.get('cezar.fixture.task-header.default')).toEqual({
      componentId: 'cezar.fixture.task-header.default',
      extensionId: null,
      isDefault: false,
      contractId: 'cezar.fixture.task-header',
      contractVersion: 1,
      component: CoreHeader,
      declaredCapabilities: ['shows-status', 'shows-title', 'not-in-the-contract'],
      capabilities: ['shows-title', 'shows-status'],
      metadata: { title: 'Task header', description: 'Core’s own header' },
      compatible: true,
      issues: [],
    })
    expect(registry.get('cezar.fixture.task-header.default')?.component).toBe(CoreHeader)
  })

  it('leaves description out of the metadata when the implementation gives none', () => {
    const registry = servedRegistry()

    registry.register(Header, coreCompact)

    expect(registry.get(coreCompact.id)?.metadata).toEqual({ title: 'Compact header' })
    expect(Object.keys(registry.get(coreCompact.id)?.metadata ?? {})).toEqual(['title'])
  })

  it('records an explicitly declared default, while ordinary and extension registrations stay non-default', () => {
    const registry = servedRegistry()

    registry.register(Header, declaredDefault, { default: true })
    registry.register(Header, coreCompact)
    const extension = fakeScope('acme.jira')
    registry.forExtension(extension.scope).provide(Header, {
      id: 'acme.jira.task-header',
      title: 'Jira header',
      component: CoreHeader,
    })

    expect(registry.get(declaredDefault.id)?.isDefault).toBe(true)
    expect(registry.get(coreCompact.id)?.isDefault).toBe(false)
    expect(registry.get('acme.jira.task-header')?.isDefault).toBe(false)
  })

  it('rejects a second default for one contract, but allows another contract and reuse after disposal', () => {
    const Other = defineComponentContract<HeaderProps>('cezar.fixture.other-header', { version: 1 })
    const registry = createComponentRegistry({ contracts: [Header, Other] })
    const first = registry.register(Header, declaredDefault, { default: true })

    const error = thrown(() => registry.register(Header, { ...coreCompact, id: 'cezar.fixture.task-header.other' }, { default: true }))

    expect(error.code).toBe('invalid-input')
    expect(error.message).toContain('cezar.fixture.task-header')
    expect(error.message).toContain('cezar.fixture.task-header.other')
    expect(registry.get(declaredDefault.id)?.isDefault).toBe(true)

    registry.register(Other, { ...coreCompact, id: 'cezar.fixture.other-header.default' }, { default: true })
    first.dispose()
    registry.register(Header, { ...declaredDefault, id: 'cezar.fixture.task-header.replacement' }, { default: true })
    expect(registry.get('cezar.fixture.task-header.replacement')?.isDefault).toBe(true)
  })

  it('freezes the registration deeply', () => {
    const registry = servedRegistry()
    registry.register(Header, coreDefault)
    const registration = registry.get(coreDefault.id)

    expect(Object.isFrozen(registration)).toBe(true)
    expect(Object.isFrozen(registration?.metadata)).toBe(true)
    expect(Object.isFrozen(registration?.declaredCapabilities)).toBe(true)
    expect(Object.isFrozen(registration?.capabilities)).toBe(true)
    expect(Object.isFrozen(registration?.issues)).toBe(true)
  })

  it('lists two core implementations of one contract in registration order', () => {
    const registry = servedRegistry()

    registry.register(Header, coreDefault)
    registry.register(Header, coreCompact)

    expect(registry.list('cezar.fixture.task-header').map((registration) => registration.componentId)).toEqual([
      'cezar.fixture.task-header.default',
      'cezar.fixture.task-header.compact',
    ])
  })

  it('refuses a taken component id with duplicate-registration, naming its owner', () => {
    const registry = servedRegistry()
    registry.register(Header, coreDefault)

    const error = thrown(() => registry.register(Header, { ...coreCompact, id: coreDefault.id }))

    expect(error.code).toBe('duplicate-registration')
    expect(error.message).toBe('Component "cezar.fixture.task-header.default" is already provided by core')
    expect(registry.list(Header.id)).toHaveLength(1)
  })

  it('refuses a contract the host does not serve with invalid-input', () => {
    const Other = defineComponentContract<HeaderProps>('cezar.fixture.other', { version: 1 })

    const error = thrown(() => servedRegistry().register(Other, { ...coreDefault, id: 'cezar.fixture.other.default' }))

    expect(error.code).toBe('invalid-input')
  })

  it('refuses the served contract at another major with contract-version-mismatch, the check’s own message', () => {
    const error = thrown(() => servedRegistry().register(HeaderV2, coreDefault))

    expect(error.code).toBe('contract-version-mismatch')
    expect(error.message).toBe(
      'cezar.fixture.task-header.default implements cezar.fixture.task-header@2, but this Cezar serves cezar.fixture.task-header@1',
    )
  })

  it('refuses an implementation missing a required capability with invalid-input', () => {
    const registry = servedRegistry()

    const error = thrown(() => registry.register(Header, { ...coreCompact, capabilities: ['shows-status'] }))

    expect(error.code).toBe('invalid-input')
    expect(error.message).toBe(
      'cezar.fixture.task-header.compact does not declare "shows-title", required by cezar.fixture.task-header@1',
    )
    expect(registry.list(Header.id)).toEqual([])
  })

  it('refuses a core component id outside cezar. with namespace-violation', () => {
    const error = thrown(() => servedRegistry().register(Header, { ...coreDefault, id: 'acme.jira.task-header' }))

    expect(error.code).toBe('namespace-violation')
    expect(error.message).toBe('Core component "acme.jira.task-header" must be under "cezar."')
  })

  it('refuses a malformed component id with invalid-id', () => {
    const error = thrown(() => servedRegistry().register(Header, { ...coreDefault, id: 'Not An Id' }))

    expect(error.code).toBe('invalid-id')
    expect(error.componentId).toBeUndefined()
  })

  it.each<[string, Record<string, unknown>, string]>([
    ['a missing title', { title: undefined }, 'title must be a non-empty string'],
    ['an empty title', { title: '' }, 'title must be a non-empty string'],
    ['a title that is not a string', { title: { secret: 'SECRET' } }, 'title must be a non-empty string'],
    ['a description that is not a string', { description: ['SECRET'] }, 'description must be a string when given'],
    ['a missing component', { component: undefined }, 'component must be a React component'],
    ['a null component', { component: null }, 'component must be a React component'],
    ['a string component', { component: 'SECRET' }, 'component must be a React component'],
    ['capabilities that are not an array', { capabilities: 'SECRET' }, 'capabilities must be an array of strings'],
    ['a capability that is not a string', { capabilities: ['shows-title', 7] }, 'capabilities[1] must be a string'],
    [
      'more than 256 capabilities',
      { capabilities: Array.from({ length: 257 }, () => 'shows-title') },
      'capabilities must hold at most 256 names',
    ],
  ])('refuses %s with invalid-input naming the field and the rule, never the value', (_label, fields, rule) => {
    const error = thrown(() =>
      servedRegistry().register(Header, { ...coreDefault, ...fields } as unknown as ComponentImplementation<HeaderProps>),
    )

    expect(error.code).toBe('invalid-input')
    expect(error.componentId).toBe('cezar.fixture.task-header.default')
    expect(error.message).toContain(`Invalid component "cezar.fixture.task-header.default": ${rule}`)
    expect(error.message).not.toContain('SECRET')
  })

  it('accepts an object component, as memo, forwardRef and lazy return', () => {
    const registry = servedRegistry()
    const memoized = { $$typeof: Symbol.for('react.memo'), type: CoreHeader, compare: null }

    registry.register(Header, { ...coreDefault, component: memoized as unknown as ComponentType<HeaderProps> })

    expect(registry.get(coreDefault.id)?.component).toBe(memoized)
  })

  it('refuses an implementation that is not an object with invalid-input', () => {
    const error = thrown(() => servedRegistry().register(Header, null as unknown as ComponentImplementation<HeaderProps>))

    expect(error.code).toBe('invalid-input')
  })

  it.each<[string, () => { contract: unknown; implementation: unknown }, string, string]>([
    [
      'a throwing title getter',
      () => ({
        contract: Header,
        implementation: Object.defineProperty({ ...coreDefault }, 'title', {
          get() {
            throw new TypeError('getter broke')
          },
        }),
      }),
      'invalid-input',
      'Invalid component "cezar.fixture.task-header.default": title could not be read',
    ],
    [
      'a revoked proxy as capabilities',
      () => ({ contract: Header, implementation: { ...coreDefault, capabilities: revoked() } }),
      'invalid-input',
      'Invalid component "cezar.fixture.task-header.default": capabilities could not be read',
    ],
    [
      'a capability list whose length throws',
      () => ({
        contract: Header,
        implementation: {
          ...coreDefault,
          capabilities: new Proxy([], {
            get(target, key) {
              if (key === 'length') throw new TypeError('length broke')
              return Reflect.get(target, key)
            },
          }),
        },
      }),
      'invalid-input',
      'Invalid component "cezar.fixture.task-header.default": capabilities could not be read',
    ],
    [
      'a revoked proxy as the implementation',
      () => ({ contract: Header, implementation: revoked() }),
      'invalid-input',
      'Invalid component: id could not be read',
    ],
    [
      'a revoked proxy as the token',
      () => ({ contract: revoked(), implementation: coreDefault }),
      'invalid-id',
      'Invalid component contract: expected { kind: "component", id, version } with a valid contribution id and a positive integer version',
    ],
  ])('turns %s into its step’s code, never a raw TypeError', (_label, input, code, message) => {
    const { contract, implementation } = input()

    const error = thrown(() =>
      servedRegistry().register(
        contract as typeof Header,
        implementation as ComponentImplementation<HeaderProps>,
      ),
    )

    expect(error).toBeInstanceOf(ComponentError)
    expect(error.code).toBe(code)
    expect(error.message).toBe(message)
  })

  it('refuses a malformed token with invalid-id before it reads the implementation', () => {
    const read = vi.fn(() => 'cezar.fixture.task-header.default')
    const implementation = Object.defineProperty({ ...coreDefault }, 'id', { get: read })

    const error = thrown(() =>
      servedRegistry().register({ kind: 'command', id: 'cezar.fixture.task-header' } as unknown as typeof Header, implementation),
    )

    expect(error.code).toBe('invalid-id')
    expect(read).not.toHaveBeenCalled()
  })
})

describe('disposal', () => {
  it('removes exactly its registration, once, and never a newer one with the same id', () => {
    const registry = servedRegistry()
    const first = registry.register(Header, coreDefault)
    const compact = registry.register(Header, coreCompact)

    first.dispose()
    const second = registry.register(Header, coreDefault)
    first.dispose()

    expect(registry.list(Header.id).map((registration) => registration.componentId)).toEqual([
      'cezar.fixture.task-header.compact',
      'cezar.fixture.task-header.default',
    ])

    second.dispose()
    second.dispose()
    compact.dispose()

    expect(registry.get(coreDefault.id)).toBeUndefined()
    expect(registry.list(Header.id)).toEqual([])
  })
})

describe('reading the registry', () => {
  it('returns a new frozen array from each list call', () => {
    const registry = servedRegistry()
    registry.register(Header, coreDefault)

    const first = registry.list(Header.id)
    const second = registry.list(Header.id)

    expect(first).not.toBe(second)
    expect(first).toEqual(second)
    expect(Object.isFrozen(first)).toBe(true)
  })

  it.each<[string, unknown]>([
    ['an unknown id', 'cezar.fixture.unknown'],
    ['a malformed id', 'Not An Id'],
    ['a number', 42],
    ['null', null],
    ['a revoked proxy', revoked()],
  ])('lists nothing for %s, without throwing', (_label, contractId) => {
    const registry = servedRegistry()
    registry.register(Header, coreDefault)

    expect(registry.list(contractId as string)).toEqual([])
  })

  it('lists the usable registrations of the token the host serves', () => {
    const registry = servedRegistry()
    registry.register(Header, coreDefault)
    registry.register(Header, coreCompact)

    const usable = registry.listUsable(Header)

    expect(usable.map((registration) => registration.componentId)).toEqual([coreDefault.id, coreCompact.id])
    expect(usable[0]).toBe(registry.get(coreDefault.id))
    expect(Object.isFrozen(usable)).toBe(true)
  })

  it.each<[string, unknown]>([
    ['the served id at another major', HeaderV2],
    ['a contract the host does not serve', defineComponentContract<HeaderProps>('cezar.fixture.other', { version: 1 })],
    ['a malformed token', { kind: 'event', id: 'cezar.fixture.task-header', version: 1 }],
    ['null', null],
    ['a revoked proxy', revoked()],
  ])('lists nothing usable for %s, without throwing', (_label, contract) => {
    const registry = servedRegistry()
    registry.register(Header, coreDefault)

    expect(registry.listUsable(contract as typeof Header)).toEqual([])
  })

  it('gets nothing for an unknown or malformed component id', () => {
    const registry = servedRegistry()
    registry.register(Header, coreDefault)

    expect(registry.get('cezar.fixture.unknown')).toBeUndefined()
    expect(registry.get(42 as unknown as string)).toBeUndefined()
    expect(registry.get(coreDefault.id)?.componentId).toBe(coreDefault.id)
  })

  it('types a usable component with its contract’s props, and a listed one with none', () => {
    const registry = servedRegistry()
    registry.register(Header, coreDefault)
    const [usable] = registry.listUsable(Header)
    const [listed] = registry.list(Header.id)
    if (usable === undefined || listed === undefined) throw new Error('expected one registration')

    renderWith(usable.component, { title: 'Fix the flaky test' })
    // @ts-expect-error — a listed registration may be incompatible: its component accepts no props
    renderWith(listed.component, { title: 'Fix the flaky test' })
    expectTypeOf(usable.component).toEqualTypeOf<ComponentType<HeaderProps>>()
    expectTypeOf(usable.issues).toEqualTypeOf<readonly []>()
    expectTypeOf(listed.component).toEqualTypeOf<ComponentType<never>>()
    expect(usable).toBe(listed)
  })

  it('types register against the contract: an implementation with other props does not fit', () => {
    const registry = servedRegistry()
    const Other: ComponentType<{ readonly count: number }> = () => null

    const typeOnly = () =>
      // @ts-expect-error — the component's props are not the contract's
      registry.register(Header, { id: 'cezar.fixture.task-header.other', title: 'Other', component: Other })

    expectTypeOf(typeOnly).toBeFunction()
  })
})

describe('forExtension(scope).provide', () => {
  const jiraHeader: ComponentImplementation<HeaderProps> = {
    id: 'acme.jira.task-header',
    title: 'Jira header',
    description: 'Shows the linked Jira issue',
    capabilities: ['shows-title', 'compact'],
    component: CoreHeader,
  }

  it('records the scope’s extension id as the provider, whatever the implementation claims', () => {
    const registry = servedRegistry()
    const { scope } = fakeScope('acme.jira')

    registry.forExtension(scope).provide(Header, {
      ...jiraHeader,
      extensionId: 'acme.other',
    } as ComponentImplementation<HeaderProps>)

    expect(registry.get('acme.jira.task-header')).toMatchObject({
      componentId: 'acme.jira.task-header',
      extensionId: 'acme.jira',
      contractId: 'cezar.fixture.task-header',
      contractVersion: 1,
      capabilities: ['shows-title', 'compact'],
      metadata: { title: 'Jira header', description: 'Shows the linked Jira issue' },
      compatible: true,
      issues: [],
    })
    expect(registry.listUsable(Header).map((registration) => registration.extensionId)).toEqual(['acme.jira'])
  })

  it.each<[string, string]>([
    ['another extension’s namespace', 'acme.compact.task-header'],
    ['the core namespace', 'cezar.fixture.task-header.jira'],
    ['its own id without a name under it', 'acme.jira'],
  ])('refuses an id in %s with namespace-violation', (_label, id) => {
    const { scope } = fakeScope('acme.jira')

    const error = thrown(() => servedRegistry().forExtension(scope).provide(Header, { ...jiraHeader, id }))

    expect(error.code).toBe('namespace-violation')
  })

  it('names the prefix an extension may use when it refuses an id', () => {
    const { scope } = fakeScope('acme.jira')

    const error = thrown(() =>
      servedRegistry().forExtension(scope).provide(Header, { ...jiraHeader, id: 'acme.compact.task-header' }),
    )

    expect(error.message).toBe('Extension "acme.jira" may only provide components under "acme.jira.", not "acme.compact.task-header"')
    expect(error.componentId).toBe('acme.compact.task-header')
  })

  it('refuses a call after the scope ended with disposed, recording nothing', () => {
    const registry = servedRegistry()
    const { scope, end } = fakeScope('acme.jira')
    const components = registry.forExtension(scope)
    end()

    expect(thrown(() => components.provide(Header, jiraHeader)).code).toBe('disposed')
    expect(registry.list(Header.id)).toEqual([])
  })

  it('refuses a built-in cezar.* extension providing an id core already registered, naming core', () => {
    const registry = servedRegistry()
    registry.register(Header, coreDefault)
    const { scope } = fakeScope('cezar.fixture')

    const error = thrown(() => registry.forExtension(scope).provide(Header, coreDefault))

    expect(error.code).toBe('duplicate-registration')
    expect(error.message).toBe('Component "cezar.fixture.task-header.default" is already provided by core')
    expect(registry.get(coreDefault.id)?.extensionId).toBeNull()
  })

  it('refuses an extension providing the same id twice, naming the extension', () => {
    const registry = servedRegistry()
    const components = registry.forExtension(fakeScope('acme.jira').scope)
    components.provide(Header, jiraHeader)

    const error = thrown(() => components.provide(Header, jiraHeader))

    expect(error.message).toBe('Component "acme.jira.task-header" is already provided by acme.jira')
  })

  it.each<[string, () => typeof Header, Partial<ComponentImplementation<HeaderProps>>, Record<string, unknown>]>([
    [
      'another major',
      () => HeaderV2,
      {},
      {
        code: 'contract-version-mismatch',
        message: 'acme.jira.task-header implements cezar.fixture.task-header@2, but this Cezar serves cezar.fixture.task-header@1',
        expected: 1,
        actual: 2,
      },
    ],
    [
      'a missing required capability',
      () => Header,
      { capabilities: ['compact'] },
      {
        code: 'missing-capability',
        message: 'acme.jira.task-header does not declare "shows-title", required by cezar.fixture.task-header@1',
        capability: 'shows-title',
      },
    ],
    [
      'a contract this Cezar does not serve',
      () => defineComponentContract<HeaderProps>('cezar.task.header', { version: 1 }),
      {},
      {
        code: 'unknown-contract',
        message: 'acme.jira.task-header implements cezar.task.header@1, which this Cezar does not serve',
        contractId: 'cezar.task.header',
      },
    ],
  ])('records %s as incompatible, reports it once, and never throws', (_label, token, fields, issue) => {
    const diagnostics: ComponentRegistration[] = []
    const registry = servedRegistry({ onDiagnostic: (registration) => diagnostics.push(registration) })
    const contract = token()

    expect(() => registry.forExtension(fakeScope('acme.jira').scope).provide(contract, { ...jiraHeader, ...fields })).not.toThrow()

    const registration = registry.get('acme.jira.task-header')
    expect(registration).toMatchObject({
      extensionId: 'acme.jira',
      contractId: contract.id,
      contractVersion: contract.version,
      compatible: false,
      capabilities: [],
      issues: [issue],
    })
    expect(Object.isFrozen(registration?.issues[0])).toBe(true)
    expect(diagnostics).toEqual([registration])
    expect(registry.list(contract.id)).toEqual([registration])
    expect(registry.listUsable(contract)).toEqual([])
    expect(registry.listUsable(Header)).toEqual([])
  })

  it('reports through the default diagnostic: one console.warn line', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const registry = createComponentRegistry()

    registry.forExtension(fakeScope('acme.jira').scope).provide(Header, jiraHeader)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]).toEqual([
      '[cezar:extensions] acme.jira.task-header (acme.jira) is not used: ' +
        'acme.jira.task-header implements cezar.fixture.task-header@1, which this Cezar does not serve',
    ])
  })

  it('swallows a throwing onDiagnostic and keeps the registration', () => {
    const registry = createComponentRegistry({
      onDiagnostic: () => {
        throw new Error('reporter is down')
      },
    })

    expect(() => registry.forExtension(fakeScope('acme.jira').scope).provide(Header, jiraHeader)).not.toThrow()
    expect(registry.get('acme.jira.task-header')?.compatible).toBe(false)
  })

  it('reports nothing for a compatible registration', () => {
    const onDiagnostic = vi.fn()
    const registry = servedRegistry({ onDiagnostic })

    registry.forExtension(fakeScope('acme.jira').scope).provide(Header, jiraHeader)

    expect(onDiagnostic).not.toHaveBeenCalled()
  })

  it('tracks the registration in the scope: ending the scope removes it and frees its id', () => {
    const registry = servedRegistry()
    const first = fakeScope('acme.jira')
    const handle = registry.forExtension(first.scope).provide(Header, jiraHeader)

    expect(first.tracked.has(handle)).toBe(true)

    first.end()

    expect(registry.list(Header.id)).toEqual([])
    const second = fakeScope('acme.jira')
    registry.forExtension(second.scope).provide(Header, jiraHeader)
    expect(registry.get('acme.jira.task-header')?.extensionId).toBe('acme.jira')
  })

  it('disposes early through the returned handle, which also untracks it', () => {
    const registry = servedRegistry()
    const { scope, tracked } = fakeScope('acme.jira')
    const handle = registry.forExtension(scope).provide(Header, jiraHeader)

    handle.dispose()

    expect(tracked.size).toBe(0)
    expect(registry.get('acme.jira.task-header')).toBeUndefined()
  })

  it('keeps a snapshot: changing the implementation object afterwards has no effect', () => {
    const registry = servedRegistry()
    const implementation = { ...jiraHeader, capabilities: ['shows-title'] }
    registry.forExtension(fakeScope('acme.jira').scope).provide(Header, implementation)

    implementation.title = 'Renamed'
    implementation.capabilities.push('compact')

    expect(registry.get('acme.jira.task-header')).toMatchObject({
      metadata: { title: 'Jira header' },
      declaredCapabilities: ['shows-title'],
      capabilities: ['shows-title'],
    })
  })

  it('runs the same field rules as core, with the same codes', () => {
    const { scope } = fakeScope('acme.jira')
    const components = servedRegistry().forExtension(scope)

    expect(thrown(() => components.provide(Header, { ...jiraHeader, title: '' })).code).toBe('invalid-input')
    expect(thrown(() => components.provide(revoked() as typeof Header, jiraHeader)).code).toBe('invalid-id')
    expect(
      thrown(() => components.provide(Header, { ...jiraHeader, capabilities: revoked() as readonly string[] })).code,
    ).toBe('invalid-input')
  })
})

describe('change notification', () => {
  const jiraHeader: ComponentImplementation<HeaderProps> = {
    id: 'acme.jira.task-header',
    title: 'Jira header',
    capabilities: ['shows-title'],
    component: CoreHeader,
  }

  /** A registry with one subscribed listener, and the revisions it saw on each call. */
  function watched() {
    const registry = servedRegistry({ onDiagnostic: () => {} })
    const seen: number[] = []
    const listener = vi.fn(() => {
      seen.push(registry.revision())
    })
    const unsubscribe = registry.subscribe(listener)
    return { registry, listener, seen, unsubscribe }
  }

  it('calls a listener once after a core register, with the revision already grown', () => {
    const { registry, listener, seen } = watched()
    const before = registry.revision()

    registry.register(Header, coreDefault)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([before + 1])
    expect(registry.revision()).toBe(before + 1)
  })

  it('calls a listener once after an extension provide, compatible or not', () => {
    const { registry, listener } = watched()

    registry.forExtension(fakeScope('acme.jira').scope).provide(Header, jiraHeader)
    expect(listener).toHaveBeenCalledTimes(1)

    registry.forExtension(fakeScope('acme.old').scope).provide(HeaderV2, { ...jiraHeader, id: 'acme.old.task-header' })
    expect(registry.get('acme.old.task-header')?.compatible).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('calls a listener once after a dispose that removed a registration, and after a scope ends', () => {
    const { registry, listener } = watched()
    const handle = registry.register(Header, coreDefault)
    const jira = fakeScope('acme.jira')
    registry.forExtension(jira.scope).provide(Header, jiraHeader)
    listener.mockClear()

    handle.dispose()
    expect(listener).toHaveBeenCalledTimes(1)

    jira.end()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(registry.list(Header.id)).toEqual([])
  })

  it('stays quiet after a second dispose, and after a dispose whose id was taken again', () => {
    const { registry, listener } = watched()
    const first = registry.register(Header, coreDefault)
    first.dispose()
    registry.register(Header, coreDefault)
    const revision = registry.revision()
    listener.mockClear()

    first.dispose()

    expect(listener).not.toHaveBeenCalled()
    expect(registry.revision()).toBe(revision)
    expect(registry.get(coreDefault.id)).toBeDefined()
  })

  it('stays quiet on a refused call: nothing was recorded', () => {
    const { registry, listener } = watched()
    registry.register(Header, coreDefault)
    listener.mockClear()

    expect(() => registry.register(Header, coreDefault)).toThrow()
    const ended = fakeScope('acme.jira')
    ended.end()
    expect(() => registry.forExtension(ended.scope).provide(Header, jiraHeader)).toThrow()

    expect(listener).not.toHaveBeenCalled()
  })

  it('grows the revision with every reported change, and keeps it between reads', () => {
    const registry = servedRegistry()
    const revisions = [registry.revision()]

    const handle = registry.register(Header, coreDefault)
    revisions.push(registry.revision())
    registry.register(Header, coreCompact)
    revisions.push(registry.revision())
    handle.dispose()
    revisions.push(registry.revision())

    expect(revisions).toEqual([...revisions].sort((a, b) => a - b))
    expect(new Set(revisions).size).toBe(4)
    expect(registry.revision()).toBe(revisions[3])
  })

  it('makes unsubscribing idempotent, and keeps the other listeners', () => {
    const { registry, listener, unsubscribe } = watched()
    const other = vi.fn()
    registry.subscribe(other)

    unsubscribe()
    unsubscribe()
    registry.register(Header, coreDefault)

    expect(listener).not.toHaveBeenCalled()
    expect(other).toHaveBeenCalledTimes(1)
  })

  it('counts the same function subscribed twice as two subscriptions', () => {
    const registry = servedRegistry()
    const listener = vi.fn()
    const first = registry.subscribe(listener)
    registry.subscribe(listener)

    registry.register(Header, coreDefault)
    expect(listener).toHaveBeenCalledTimes(2)

    first()
    registry.register(Header, coreCompact)
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('swallows a throwing listener: the next one still runs and the change stands', () => {
    const registry = servedRegistry()
    registry.subscribe(() => {
      throw new Error('listener bug')
    })
    const next = vi.fn()
    registry.subscribe(next)

    expect(() => registry.register(Header, coreDefault)).not.toThrow()

    expect(next).toHaveBeenCalledTimes(1)
    expect(registry.get(coreDefault.id)).toBeDefined()
  })

  it('works unbound, as useSyncExternalStore calls it', () => {
    const registry = servedRegistry()
    const { subscribe, revision } = registry
    const listener = vi.fn()

    const unsubscribe = subscribe(listener)
    registry.register(Header, coreDefault)
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(revision()).toBe(registry.revision())
  })

  it('still imports nothing at run time except the extension API', () => {
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'registry.ts'), 'utf8')
    const runtime = [...source.matchAll(/^import[ \t]+(?!type[ \t])[\s\S]*?\bfrom[ \t]*'([^']+)'/gm)].map(
      ([, specifier]) => specifier,
    )

    expect(runtime).toEqual(['@open-mercato/cezar-extension-api'])
    // A dynamic import names its module in quotes; a comment's "import (" does not.
    expect(source).not.toMatch(/\bimport[ \t]*\([ \t]*['"`]/)
  })
})
