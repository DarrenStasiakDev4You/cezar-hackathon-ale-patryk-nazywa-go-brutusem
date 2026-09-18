import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  defineComponentContract,
  ExtensionDefinitionError,
  isExtensionError,
  type ComponentContract,
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
  it('returns a frozen { kind, id, version } with no phantom key at runtime', () => {
    const contract = defineComponentContract<GreetingProps>('acme.hello.greeting', { version: 2 })
    expect(contract).toEqual({ kind: 'component', id: 'acme.hello.greeting', version: 2 })
    expect('__props' in contract).toBe(false)
    expect(Object.isFrozen(contract)).toBe(true)
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
