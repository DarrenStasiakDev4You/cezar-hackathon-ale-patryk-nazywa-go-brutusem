import { afterEach, describe, expect, it, vi } from 'vitest'

import { defineComponentContract, isExtensionError } from '@open-mercato/cezar-extension-api'

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

  it('refuses a catalog that is not an array with invalid-input', () => {
    const error = thrown(() => createComponentRegistry({ contracts: {} as unknown as AnyComponentContract[] }))

    expect(error.code).toBe('invalid-input')
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
