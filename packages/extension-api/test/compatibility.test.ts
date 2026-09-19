import { describe, expect, expectTypeOf, it } from 'vitest'

import { checkComponentCompatibility, type ComponentCompatibility } from '../src/compatibility.ts'
import { defineComponentContract, type ComponentImplementation } from '../src/index.ts'

interface ComposerProps {
  draft: string
  onSubmit: (text: string) => Promise<void>
}

const Composer = defineComponentContract<ComposerProps>('cezar.test.composer', {
  version: 1,
  requiredCapabilities: ['restores-draft', 'submits.on-enter'],
  optionalCapabilities: ['attachments', 'dictation'],
  layout: { sticky: 'bottom', minBlockSize: 96 },
})

const component = (): null => null

function implementation(capabilities?: readonly string[]): ComponentImplementation<ComposerProps> {
  return {
    id: 'acme.zen.composer',
    title: 'Zen',
    ...(capabilities === undefined ? {} : { capabilities }),
    component,
  }
}

/** Every value the check could meet from extension code, and never throw on. */
function check(...args: unknown[]): ComponentCompatibility {
  return (checkComponentCompatibility as (...values: unknown[]) => ComponentCompatibility)(...args)
}

/** A copy of `target` (an array stays an array) whose `key` throws when read. */
function throwingGetter<T extends object>(target: T, key: string): T {
  const copy = (Array.isArray(target) ? [...(target as unknown[])] : { ...target }) as T
  return Object.defineProperty(copy, key, {
    enumerable: true,
    get() {
      throw new Error(`reading ${key}`)
    },
  })
}

function revoked(): object {
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  return proxy
}

describe('checkComponentCompatibility — compatible', () => {
  it('passes when every required capability is declared', () => {
    const outcome = checkComponentCompatibility(Composer, implementation(['submits.on-enter', 'restores-draft']))
    expect(outcome).toEqual({ compatible: true, issues: [], capabilities: ['restores-draft', 'submits.on-enter'] })
  })

  it('ignores declared names that are neither required nor optional', () => {
    const declared = implementation(['restores-draft', 'submits.on-enter', 'glows'])
    const outcome = checkComponentCompatibility(Composer, declared)
    expect(outcome.compatible).toBe(true)
    expect(outcome.issues).toEqual([])
    expect(outcome.capabilities).toEqual(['restores-draft', 'submits.on-enter'])
  })

  it('passes a contract with no requirements and an implementation with no declarations', () => {
    const Plain = defineComponentContract<ComposerProps>('cezar.test.plain', { version: 3 })
    const nothing = { compatible: true, issues: [], capabilities: [] }
    expect(checkComponentCompatibility(Plain, implementation())).toEqual(nothing)
    expect(checkComponentCompatibility(Plain, implementation([]))).toEqual(nothing)
  })

  it('lists the required capabilities, then only the declared optional ones in the contract’s order', () => {
    const outcome = checkComponentCompatibility(
      Composer,
      implementation(['dictation', 'glows', 'restores-draft', 'attachments', 'submits.on-enter']),
    )
    expect(outcome.capabilities).toEqual(['restores-draft', 'submits.on-enter', 'attachments', 'dictation'])

    const some = checkComponentCompatibility(
      Composer,
      implementation(['dictation', 'restores-draft', 'submits.on-enter']),
    )
    expect(some.capabilities).toEqual(['restores-draft', 'submits.on-enter', 'dictation'])
  })

  it('defaults implemented to the contract itself', () => {
    const declared = implementation(['restores-draft', 'submits.on-enter'])
    expect(checkComponentCompatibility(Composer, declared)).toEqual(
      checkComponentCompatibility(Composer, declared, Composer),
    )
    expect(checkComponentCompatibility(Composer, declared, undefined).compatible).toBe(true)
  })

  it('returns a frozen result', () => {
    const outcome = checkComponentCompatibility(Composer, implementation(['restores-draft']))
    expect(Object.isFrozen(outcome)).toBe(true)
    expect(Object.isFrozen(outcome.issues)).toBe(true)
    expect(Object.isFrozen(outcome.issues[0])).toBe(true)
    expect(Object.isFrozen(outcome.capabilities)).toBe(true)
  })
})

describe('checkComponentCompatibility — issues', () => {
  it('reports every missing required capability at once, naming the contract as id@version', () => {
    const outcome = checkComponentCompatibility(Composer, implementation(['attachments']))
    expect(outcome).toEqual({
      compatible: false,
      issues: [
        {
          code: 'missing-capability',
          message: 'acme.zen.composer does not declare "restores-draft", required by cezar.test.composer@1',
          capability: 'restores-draft',
        },
        {
          code: 'missing-capability',
          message: 'acme.zen.composer does not declare "submits.on-enter", required by cezar.test.composer@1',
          capability: 'submits.on-enter',
        },
      ],
      capabilities: [],
    })
  })

  it('reports a different contract id as exactly one contract-id-mismatch', () => {
    const Other = defineComponentContract<ComposerProps>('acme.zen.editor', { version: 1 })
    const outcome = checkComponentCompatibility(Composer, implementation([]), Other)
    expect(outcome).toEqual({
      compatible: false,
      issues: [
        {
          code: 'contract-id-mismatch',
          message: 'acme.zen.composer implements acme.zen.editor@1, but was checked against cezar.test.composer@1',
          expected: 'cezar.test.composer',
          actual: 'acme.zen.editor',
        },
      ],
      capabilities: [],
    })
  })

  it('reports a different major as exactly one contract-version-mismatch, with no missing capability beside it', () => {
    const ComposerV2 = defineComponentContract<ComposerProps>('cezar.test.composer', {
      version: 2,
      requiredCapabilities: ['restores-draft', 'submits.on-enter', 'streams'],
    })
    const outcome = checkComponentCompatibility(ComposerV2, implementation([]), Composer)
    expect(outcome).toEqual({
      compatible: false,
      issues: [
        {
          code: 'contract-version-mismatch',
          message: 'acme.zen.composer implements cezar.test.composer@1, but this Cezar serves cezar.test.composer@2',
          expected: 2,
          actual: 1,
        },
      ],
      capabilities: [],
    })
  })

  it('checks the id before the version', () => {
    const OtherV2 = defineComponentContract<ComposerProps>('acme.zen.editor', { version: 2 })
    const outcome = checkComponentCompatibility(Composer, implementation([]), OtherV2)
    expect(outcome.issues.map((issue) => issue.code)).toEqual(['contract-id-mismatch'])
  })

  it('reports a repeated required name once', () => {
    const structural = {
      id: 'cezar.test.composer',
      version: 1,
      requiredCapabilities: ['restores-draft', 'restores-draft'],
    }
    const outcome = checkComponentCompatibility(structural, implementation([]))
    expect(outcome.issues).toHaveLength(1)
  })
})

describe('checkComponentCompatibility — shapes from an older copy of the package', () => {
  it('treats a contract without capability lists as requiring and offering nothing', () => {
    const older = { kind: 'component', id: 'cezar.test.composer', version: 1 } as const
    const outcome = checkComponentCompatibility(older, implementation(['restores-draft', 'attachments']))
    expect(outcome).toEqual({ compatible: true, issues: [], capabilities: [] })
  })

  it('treats an implementation without capabilities as declaring none', () => {
    const outcome = checkComponentCompatibility(Composer, implementation())
    expect(outcome.issues.map((issue) => issue.code)).toEqual(['missing-capability', 'missing-capability'])
  })

  it('reads only the id and version of the implemented token', () => {
    const older = { kind: 'component', id: 'cezar.test.composer', version: 1 } as const
    const declared = implementation(['restores-draft', 'submits.on-enter'])
    expect(checkComponentCompatibility(Composer, declared, older).compatible).toBe(true)
  })
})

describe('checkComponentCompatibility — hostile input', () => {
  const good = implementation(['restores-draft', 'submits.on-enter'])

  it.each<[string, () => ComponentCompatibility, string[]]>([
    ['contract is null', () => check(null, good), ['contract']],
    ['contract is a number', () => check(42, good), ['contract']],
    ['contract is a function', () => check(() => Composer, good), ['contract']],
    ['implementation is undefined', () => check(Composer, undefined), ['implementation']],
    ['implementation is a string', () => check(Composer, 'acme.zen.composer'), ['implementation']],
    ['implemented is null', () => check(Composer, good, null), ['implemented']],
    ['contract.id is a number', () => check({ ...Composer, id: 7 }, good), ['contract.id']],
    ['contract.version is not an integer', () => check({ ...Composer, version: 1.5 }, good), ['contract.version']],
    ['contract.version is zero', () => check({ ...Composer, version: 0 }, good), ['contract.version']],
    ['contract.version is a string', () => check({ ...Composer, version: '1' }, good), ['contract.version']],
    [
      'contract.requiredCapabilities is a string',
      () => check({ ...Composer, requiredCapabilities: 'restores-draft' }, good),
      ['contract.requiredCapabilities'],
    ],
    [
      'contract.optionalCapabilities holds a number',
      () => check({ ...Composer, optionalCapabilities: ['attachments', 3] }, good),
      ['contract.optionalCapabilities[1]'],
    ],
    ['implementation.id is missing', () => check(Composer, { capabilities: [] }), ['implementation.id']],
    [
      'implementation.capabilities holds a non-string',
      () => check(Composer, { ...good, capabilities: ['restores-draft', { name: 'x' }] }),
      ['implementation.capabilities[1]'],
    ],
    [
      'implementation.capabilities is an object',
      () => check(Composer, { ...good, capabilities: { 0: 'restores-draft', length: 1 } }),
      ['implementation.capabilities'],
    ],
    ['implemented.version is missing', () => check(Composer, good, { id: Composer.id }), ['implemented.version']],
    ['contract.id is a throwing getter', () => check(throwingGetter(Composer, 'id'), good), ['contract.id']],
    [
      'implementation.capabilities is a throwing getter',
      () => check(Composer, throwingGetter(good, 'capabilities')),
      ['implementation.capabilities'],
    ],
    [
      'implemented.version is a throwing getter',
      () => check(Composer, good, throwingGetter(Composer, 'version')),
      ['implemented.version'],
    ],
    [
      'a capability element is a throwing getter',
      () => check(Composer, { ...good, capabilities: throwingGetter(['restores-draft', 'x'], '1') }),
      ['implementation.capabilities[1]'],
    ],
    [
      'contract is a revoked proxy',
      () => check(revoked(), good),
      ['contract.id', 'contract.version', 'contract.requiredCapabilities', 'contract.optionalCapabilities'],
    ],
    [
      'implementation is a revoked proxy',
      () => check(Composer, revoked()),
      ['implementation.id', 'implementation.capabilities'],
    ],
    [
      'implementation.capabilities is a revoked proxy',
      () => check(Composer, { ...good, capabilities: revoked() }),
      ['implementation.capabilities'],
    ],
    ['every argument is malformed', () => check(null, null, null), ['contract', 'implementation', 'implemented']],
  ])('returns malformed, never throwing, when %s', (_, run, paths) => {
    let outcome: ComponentCompatibility | undefined
    expect(() => {
      outcome = run()
    }).not.toThrow()
    expect(outcome?.compatible).toBe(false)
    expect(outcome?.capabilities).toEqual([])
    expect(outcome?.issues.map((issue) => issue.code)).toEqual(paths.map(() => 'malformed'))
    expect(outcome?.issues.map((issue) => (issue.code === 'malformed' ? issue.path : ''))).toEqual(paths)
  })

  it('names the field and the rule in a malformed message', () => {
    const outcome = check(Composer, { ...good, capabilities: ['restores-draft', 7] })
    expect(outcome.issues).toEqual([
      {
        code: 'malformed',
        message: 'implementation.capabilities[1] must be a string',
        path: 'implementation.capabilities[1]',
      },
    ])
    expect(check(throwingGetter(Composer, 'id'), good).issues[0]?.message).toBe('contract.id could not be read')
  })

  it('ends the check at a malformed field — no id, version or capability issue beside it', () => {
    const Other = defineComponentContract<ComposerProps>('acme.zen.editor', { version: 9 })
    const outcome = check({ ...Composer, optionalCapabilities: [1] }, implementation([]), Other)
    expect(outcome.issues.map((issue) => issue.code)).toEqual(['malformed'])
  })

  it('reads each field once', () => {
    const reads = new Map<string, number>()
    const counting = <T extends object>(target: T, name: string): T =>
      new Proxy(target, {
        get(inner, key, receiver) {
          const label = `${name}.${String(key)}`
          reads.set(label, (reads.get(label) ?? 0) + 1)
          return Reflect.get(inner, key, receiver) as unknown
        },
      })
    checkComponentCompatibility(
      counting({ ...Composer }, 'contract'),
      counting({ ...good }, 'implementation'),
      counting({ ...Composer }, 'implemented'),
    )
    expect(Object.fromEntries(reads)).toEqual({
      'contract.id': 1,
      'contract.version': 1,
      'contract.requiredCapabilities': 1,
      'contract.optionalCapabilities': 1,
      'implementation.id': 1,
      'implementation.capabilities': 1,
      'implemented.id': 1,
      'implemented.version': 1,
    })
  })

  it('never calls a method on its input', () => {
    const trap = (): never => {
      throw new Error('a method was called')
    }
    const booby = <T extends object>(target: T): T =>
      Object.assign(target, {
        includes: trap,
        indexOf: trap,
        map: trap,
        forEach: trap,
        toString: trap,
        valueOf: trap,
        [Symbol.iterator]: trap,
        [Symbol.toPrimitive]: trap,
      })
    const outcome = checkComponentCompatibility(
      booby({ ...Composer, requiredCapabilities: booby(['restores-draft']), optionalCapabilities: booby(['dictation']) }),
      booby({ ...good, capabilities: booby(['restores-draft', 'dictation']) }),
      booby({ ...Composer }),
    )
    expect(outcome).toEqual({ compatible: true, issues: [], capabilities: ['restores-draft', 'dictation'] })
  })
})

// Type tests: checked by `npm run typecheck`, never executed.
describe('checkComponentCompatibility — types', () => {
  it('accepts a contract token, a structurally built one, and an implementation typed without capabilities', () => {
    const unused = (): void => {
      const structural = { kind: 'component', id: 'cezar.test.composer', version: 1 } as const
      checkComponentCompatibility(structural, { id: 'acme.zen.composer' })
      const withoutCapabilities: { readonly id: string; readonly title: string } = {
        id: 'acme.zen.composer',
        title: 'Zen',
      }
      checkComponentCompatibility(Composer, withoutCapabilities, structural)
      checkComponentCompatibility(Composer, implementation())
      // @ts-expect-error — the implementation's id is required
      checkComponentCompatibility(Composer, { capabilities: ['restores-draft'] })
      // @ts-expect-error — capabilities are a list of names
      checkComponentCompatibility(Composer, { id: 'acme.zen.composer', capabilities: 'restores-draft' })
      // @ts-expect-error — the implemented token needs its version
      checkComponentCompatibility(Composer, implementation(), { id: 'cezar.test.composer' })
    }
    expectTypeOf(unused).toBeFunction()
    expectTypeOf(checkComponentCompatibility).returns.toEqualTypeOf<ComponentCompatibility>()
  })
})
