import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  defineComponentContract,
  ExtensionDefinitionError,
  isExtensionError,
  type ComponentCapability,
  type ComponentContract,
  type ComponentContractOptions,
  type ComponentLayout,
  type ComponentProps,
  type ComponentRegistry,
  type Disposable,
  type ExtensionContext,
  type ExtensionStorage,
  type JsonValue,
} from '../src/index.ts'

interface GreetingProps {
  name: string
  /** Called when the user dismisses the greeting. */
  onDismiss?: () => void
}

function thrown(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

describe('defineComponentContract', () => {
  it('returns a frozen token with empty capability lists and no phantom key at runtime', () => {
    const contract = defineComponentContract<GreetingProps>('acme.hello.greeting', { version: 2 })
    expect(contract).toEqual({
      kind: 'component',
      id: 'acme.hello.greeting',
      version: 2,
      requiredCapabilities: [],
      optionalCapabilities: [],
    })
    expect('__props' in contract).toBe(false)
    expect('layout' in contract).toBe(false)
    expect(Object.isFrozen(contract)).toBe(true)
    expect(Object.isFrozen(contract.requiredCapabilities)).toBe(true)
    expect(Object.isFrozen(contract.optionalCapabilities)).toBe(true)
  })

  it('records capabilities and layout as deeply frozen copies', () => {
    const required = ['greets-by-name', 'task.continue']
    const optional = ['waves']
    const layout = { sizing: 'fill', sticky: 'bottom', minBlockSize: 96 } as const
    const contract = defineComponentContract<GreetingProps>('acme.hello.greeting', {
      version: 1,
      requiredCapabilities: required,
      optionalCapabilities: optional,
      layout,
    })
    expect(contract).toEqual({
      kind: 'component',
      id: 'acme.hello.greeting',
      version: 1,
      requiredCapabilities: ['greets-by-name', 'task.continue'],
      optionalCapabilities: ['waves'],
      layout: { sizing: 'fill', sticky: 'bottom', minBlockSize: 96 },
    })
    expect(contract.requiredCapabilities).not.toBe(required)
    expect(contract.layout).not.toBe(layout)
    expect(Object.isFrozen(contract.requiredCapabilities)).toBe(true)
    expect(Object.isFrozen(contract.optionalCapabilities)).toBe(true)
    expect(Object.isFrozen(contract.layout)).toBe(true)
    required.push('late')
    expect(contract.requiredCapabilities).toEqual(['greets-by-name', 'task.continue'])
  })

  it('accepts the layout bounds and a partial layout', () => {
    expect(defineComponentContract('acme.hello.a', { version: 1, layout: { minBlockSize: 0 } }).layout).toEqual({
      minBlockSize: 0,
    })
    expect(defineComponentContract('acme.hello.b', { version: 1, layout: { minBlockSize: 2048 } }).layout).toEqual({
      minBlockSize: 2048,
    })
    expect(defineComponentContract('acme.hello.c', { version: 1, layout: {} }).layout).toEqual({})
  })

  it('accepts 32 capabilities across the two lists', () => {
    const names = Array.from({ length: 32 }, (_, index) => `c${index}`)
    const contract = defineComponentContract('acme.hello.greeting', {
      version: 1,
      requiredCapabilities: names.slice(0, 20),
      optionalCapabilities: names.slice(20),
    })
    expect(contract.requiredCapabilities).toHaveLength(20)
    expect(contract.optionalCapabilities).toHaveLength(12)
  })

  it.each<[string, Record<string, unknown>, string[]]>([
    ['requiredCapabilities is not an array', { requiredCapabilities: 'greets' }, ['requiredCapabilities']],
    ['optionalCapabilities is not an array', { optionalCapabilities: { 0: 'waves' } }, ['optionalCapabilities']],
    ['a capability is not a string', { requiredCapabilities: ['ok', 7] }, ['requiredCapabilities[1]']],
    ['a capability has an upper-case letter', { requiredCapabilities: ['Greets'] }, ['requiredCapabilities[0]']],
    ['a capability has an empty segment', { optionalCapabilities: ['task..continue'] }, ['optionalCapabilities[0]']],
    ['a capability starts with a dash', { requiredCapabilities: ['-greets'] }, ['requiredCapabilities[0]']],
    ['a capability is empty', { requiredCapabilities: [''] }, ['requiredCapabilities[0]']],
    ['a capability is over 64 characters', { requiredCapabilities: ['a'.repeat(65)] }, ['requiredCapabilities[0]']],
    ['a required capability repeats', { requiredCapabilities: ['a', 'b', 'a'] }, ['requiredCapabilities[2]']],
    ['an optional capability repeats', { optionalCapabilities: ['a', 'a'] }, ['optionalCapabilities[1]']],
    [
      'an optional capability is also required',
      { requiredCapabilities: ['a', 'b'], optionalCapabilities: ['b'] },
      ['optionalCapabilities[0]'],
    ],
    [
      'the lists hold more than 32 names together',
      {
        requiredCapabilities: Array.from({ length: 16 }, (_, index) => `r${index}`),
        optionalCapabilities: Array.from({ length: 17 }, (_, index) => `o${index}`),
      },
      [''],
    ],
    ['layout is not an object', { layout: 'sticky' }, ['layout']],
    ['layout is null', { layout: null }, ['layout']],
    ['layout is an array', { layout: [] }, ['layout']],
    ['layout has an unknown key', { layout: { sticky: 'top', align: 'start' } }, ['layout.align']],
    ['sizing is outside its union', { layout: { sizing: 'grow' } }, ['layout.sizing']],
    ['sticky is outside its union', { layout: { sticky: 'left' } }, ['layout.sticky']],
    ['minBlockSize is negative', { layout: { minBlockSize: -1 } }, ['layout.minBlockSize']],
    ['minBlockSize is over 2048', { layout: { minBlockSize: 2049 } }, ['layout.minBlockSize']],
    ['minBlockSize is not an integer', { layout: { minBlockSize: 56.5 } }, ['layout.minBlockSize']],
    ['minBlockSize is a string', { layout: { minBlockSize: '56' } }, ['layout.minBlockSize']],
  ])('throws invalid-id when %s', (_, options, paths) => {
    const error = thrown(() =>
      defineComponentContract('acme.hello.greeting', { version: 1, ...options } as unknown as { version: number }),
    )
    expect(error).toBeInstanceOf(ExtensionDefinitionError)
    expect(isExtensionError(error, 'invalid-id')).toBe(true)
    expect((error as ExtensionDefinitionError).issues.map((issue) => issue.path)).toEqual(paths)
  })

  it('names the rule each capability and layout issue broke', () => {
    const error = thrown(() =>
      defineComponentContract('acme.hello.greeting', {
        version: 1,
        requiredCapabilities: ['a', 'a'],
        optionalCapabilities: ['a'],
        layout: { align: 'start' } as never,
      }),
    )
    expect((error as Error).message).toBe(
      'Invalid component "acme.hello.greeting": requiredCapabilities[1] must be unique — it repeats ' +
        'requiredCapabilities[0]; optionalCapabilities[0] must not also be required — it is requiredCapabilities[0]; ' +
        'layout.align is not a layout field (sizing, sticky, minBlockSize)',
    )
  })

  it('reports a bad id, a bad version and a bad capability together', () => {
    const error = thrown(() => defineComponentContract('greeting', { version: 0, requiredCapabilities: ['Bad'] }))
    expect((error as ExtensionDefinitionError).issues.map((issue) => issue.path)).toEqual([
      'id',
      'version',
      'requiredCapabilities[0]',
    ])
    expect((error as Error).message).toBe(
      'Invalid component "greeting": id must be two or more dot-separated segments of [a-z0-9][a-z0-9-]*, ' +
        'at most 128 characters; version must be a positive integer — the major version of the contract; ' +
        'requiredCapabilities[0] must be one or more dot-separated segments of [a-z0-9][a-z0-9-]*, at most 64 characters',
    )
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', undefined])(
    'throws invalid-id when version is %s',
    (version) => {
      const error = thrown(() =>
        defineComponentContract('acme.hello.greeting', { version } as unknown as { version: number }),
      )
      expect(error).toBeInstanceOf(ExtensionDefinitionError)
      expect(isExtensionError(error, 'invalid-id')).toBe(true)
      expect((error as ExtensionDefinitionError).issues.map((issue) => issue.path)).toEqual(['version'])
    },
  )

  it('throws invalid-id when the options are missing', () => {
    const error = thrown(() =>
      defineComponentContract('acme.hello.greeting', undefined as unknown as { version: number }),
    )
    expect(isExtensionError(error, 'invalid-id')).toBe(true)
  })

  it('throws invalid-id for a malformed id', () => {
    const error = thrown(() => defineComponentContract('greeting', { version: 1 }))
    expect(isExtensionError(error, 'invalid-id')).toBe(true)
    expect((error as ExtensionDefinitionError).issues.map((issue) => issue.path)).toEqual(['id'])
  })

  it('reports a malformed id and a bad version together', () => {
    const error = thrown(() => defineComponentContract('greeting', { version: 0 }))
    expect((error as ExtensionDefinitionError).issues.map((issue) => issue.path)).toEqual(['id', 'version'])
    expect((error as Error).message).toBe(
      'Invalid component "greeting": id must be two or more dot-separated segments of [a-z0-9][a-z0-9-]*, ' +
        'at most 128 characters; version must be a positive integer — the major version of the contract',
    )
  })
})

// Type tests: checked by `npm run typecheck`, never executed.
describe('types', () => {
  const Greeting = defineComponentContract<GreetingProps>('acme.hello.greeting', { version: 1 })

  it('reads a contract’s props back', () => {
    expectTypeOf<ComponentProps<typeof Greeting>>().toEqualTypeOf<GreetingProps>()
    expectTypeOf<ComponentProps<string>>().toEqualTypeOf<never>()
  })

  it('reads the same props back from a contract with capabilities and layout', () => {
    const Rich = defineComponentContract<GreetingProps>('acme.hello.rich', {
      version: 1,
      requiredCapabilities: ['greets-by-name'],
      optionalCapabilities: ['waves'],
      layout: { sizing: 'content', sticky: 'top', minBlockSize: 56 },
    })
    expectTypeOf<ComponentProps<typeof Rich>>().toEqualTypeOf<GreetingProps>()
    expectTypeOf(Rich).toEqualTypeOf<ComponentContract<GreetingProps>>()
    expectTypeOf(Rich.requiredCapabilities).toEqualTypeOf<readonly ComponentCapability[] | undefined>()
    expectTypeOf(Rich.layout).toEqualTypeOf<ComponentLayout | undefined>()
  })

  it('rejects a layout value outside its type at compile time', () => {
    const unused = (): void => {
      // @ts-expect-error — `grow` is not a sizing
      defineComponentContract<GreetingProps>('acme.hello.grow', { version: 1, layout: { sizing: 'grow' } })
      // @ts-expect-error — `left` is not a sticky edge
      defineComponentContract<GreetingProps>('acme.hello.left', { version: 1, layout: { sticky: 'left' } })
      // @ts-expect-error — `align` is not a layout field
      defineComponentContract<GreetingProps>('acme.hello.align', { version: 1, layout: { align: 'start' } })
      // @ts-expect-error — capabilities are names, not objects
      defineComponentContract<GreetingProps>('acme.hello.caps', { version: 1, requiredCapabilities: [{ name: 'x' }] })
    }
    expectTypeOf(unused).toBeFunction()
  })

  it('still fits a structurally built token, as an older copy of the package makes it', () => {
    const structural = { kind: 'component', id: 'acme.hello.greeting', version: 1 } as const
    expectTypeOf(structural).toExtend<ComponentContract<GreetingProps>>()
    const options: ComponentContractOptions = { version: 1 }
    expectTypeOf(options).toExtend<Parameters<typeof defineComponentContract>[1]>()
  })

  it('keeps contracts with different props distinct', () => {
    expectTypeOf<ComponentContract<GreetingProps>>().not.toExtend<ComponentContract<{ count: number }>>()
  })

  it('accepts an implementation of the contract’s props and rejects one with other props', () => {
    const unused = (components: ComponentRegistry): void => {
      const disposable = components.provide(Greeting, {
        id: 'acme.hello.plain',
        title: 'Plain greeting',
        component: ({ name, onDismiss }) => {
          expectTypeOf(name).toEqualTypeOf<string>()
          expectTypeOf(onDismiss).toEqualTypeOf<(() => void) | undefined>()
          return `Hello, ${name}`
        },
      })
      expectTypeOf(disposable).toEqualTypeOf<Disposable>()
      // An implementation may ignore props it does not need.
      components.provide(Greeting, { id: 'acme.hello.static', title: 'Static', component: () => 'Hi' })
      components.provide(Greeting, {
        id: 'acme.hello.wrong',
        title: 'Wrong props',
        // @ts-expect-error — the implementation's props must be the contract's
        component: ({ count }: { count: number }) => String(count),
      })
    }
    expectTypeOf(unused).toBeFunction()
  })

  it('stores JSON values, interfaces included, and nothing else', () => {
    interface Settings {
      density: 'compact' | 'cozy'
      pinned?: string[]
    }
    const unused = async (storage: ExtensionStorage): Promise<void> => {
      const settings: Settings = { density: 'compact' }
      await storage.set('settings', settings)
      await storage.set('count', 1)
      expectTypeOf(await storage.get('settings')).toEqualTypeOf<JsonValue | undefined>()
      expectTypeOf(await storage.get<Settings>('settings')).toEqualTypeOf<Settings | undefined>()
      const stored = await storage.get('count')
      await storage.set('copy', stored ?? null)
      expectTypeOf(await storage.keys()).toEqualTypeOf<string[]>()
      // @ts-expect-error — a Date is not JSON
      await storage.set('at', new Date())
      // @ts-expect-error — nor is a function
      await storage.set('callback', () => 1)
    }
    expectTypeOf(unused).toBeFunction()
  })

  it('hands the extension every surface through its context', () => {
    expectTypeOf<ExtensionContext['storage']>().toEqualTypeOf<ExtensionStorage>()
    expectTypeOf<ExtensionContext['components']>().toEqualTypeOf<ComponentRegistry>()
    expectTypeOf<ExtensionContext>().toHaveProperty('commands')
    expectTypeOf<ExtensionContext>().toHaveProperty('events')
    expectTypeOf<ExtensionContext>().toHaveProperty('subscriptions')
    expectTypeOf<ExtensionContext>().toHaveProperty('extension')
  })
})
