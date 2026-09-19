import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  defineCommand,
  defineEvent,
  ExtensionDefinitionError,
  isExtensionError,
  type Commands,
  type CommandToken,
  type Disposable,
  type Events,
  type EventToken,
} from '../src/index.ts'
import { createFakeContext } from './fake-context.ts'

interface Pay {
  amount: number
  note?: string
}

function thrown(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

describe('defineCommand', () => {
  it('returns a frozen { kind, id } with no phantom key at runtime', () => {
    const token = defineCommand<[name: string], string>('acme.hello.say-hello')
    expect(token).toEqual({ kind: 'command', id: 'acme.hello.say-hello' })
    expect(Object.keys(token)).toEqual(['kind', 'id'])
    expect('__types' in token).toBe(false)
    expect(Object.isFrozen(token)).toBe(true)
  })

  it.each(['acme', 'Acme.hello', 'acme..hello', ''])('throws invalid-id for %j', (id) => {
    const error = thrown(() => defineCommand(id))
    expect(error).toBeInstanceOf(ExtensionDefinitionError)
    expect(isExtensionError(error, 'invalid-id')).toBe(true)
    expect((error as ExtensionDefinitionError).issues.map((issue) => issue.path)).toEqual(['id'])
    expect((error as Error).message).toContain(`Invalid command ${JSON.stringify(id)}: id must be`)
  })

  it.each([10n, 42, undefined, Symbol('id')])('throws invalid-id — not a TypeError — for a non-string id (%s)', (id) => {
    // A JS caller may pass anything; describing the id must not itself throw.
    const error = thrown(() => defineCommand(id as unknown as string))
    expect(error).toBeInstanceOf(ExtensionDefinitionError)
    expect((error as Error).message).toContain(`(${typeof id} id)`)
  })
})

describe('defineEvent', () => {
  it('returns a frozen { kind, id } with no phantom key at runtime', () => {
    const token = defineEvent<Pay>('acme.pay.paid')
    expect(token).toEqual({ kind: 'event', id: 'acme.pay.paid' })
    expect('__payload' in token).toBe(false)
    expect(Object.isFrozen(token)).toBe(true)
  })

  it('throws invalid-id for a malformed id', () => {
    expect(isExtensionError(thrown(() => defineEvent('paid')), 'invalid-id')).toBe(true)
  })

  it('matches by id: two definitions of one id are equal data, not the same object', () => {
    // What the host relies on — each extension bundle carries its own copy of the package.
    const a = defineEvent<Pay>('acme.pay.paid')
    const b = defineEvent<Pay>('acme.pay.paid')
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})

// Type tests: checked by `npm run typecheck`, never executed.
describe('types', () => {
  it('rejects non-JSON arguments, results and payloads at the definition site', () => {
    const unused = (): void => {
      // @ts-expect-error — a callback argument is not JSON
      defineCommand<[onDone: () => void], void>('acme.x.run')
      // @ts-expect-error — a Date result is not JSON
      defineCommand<[], Date>('acme.x.when')
      // @ts-expect-error — a payload with a Date field is not JSON
      defineEvent<{ at: Date }>('acme.x.at')
    }
    expectTypeOf(unused).toBeFunction()
    expectTypeOf(defineCommand<[Pay, number[]], Pay | null>).returns.toEqualTypeOf<
      CommandToken<[Pay, number[]], Pay | null>
    >()
    expectTypeOf(defineEvent('acme.tasks.refreshed')).toEqualTypeOf<EventToken<void>>()
  })

  it('checks command arguments and results end to end', () => {
    const SayHello = defineCommand<[name: string], string>('acme.hello.say-hello')
    const unused = (commands: Commands): void => {
      commands.register(SayHello, async (name) => {
        expectTypeOf(name).toEqualTypeOf<string>()
        return `Hello, ${name}!`
      })
      commands.register(SayHello, (name) => name.toUpperCase(), { title: 'Hello: say hello' })
      expectTypeOf(commands.execute(SayHello, 'Ada')).toEqualTypeOf<Promise<string>>()
      // @ts-expect-error — wrong argument type
      void commands.execute(SayHello, 42)
      // @ts-expect-error — missing argument
      void commands.execute(SayHello)
      // @ts-expect-error — the handler's result must match the token
      commands.register(SayHello, () => 42)
      // @ts-expect-error — the handler's parameter must match the token
      commands.register(SayHello, (name: number) => String(name))
      // @ts-expect-error — nor may the result be WIDER than the token's (a union is not a string)
      commands.register(SayHello, (name) => (name === '' ? 0 : name))
    }
    expectTypeOf(unused).toBeFunction()
  })

  it('asks `has` about a token or a bare id, and nothing else', () => {
    const SayHello = defineCommand<[name: string], string>('acme.hello.say-hello')
    const unused = (commands: Commands): void => {
      expectTypeOf(commands.has(SayHello)).toEqualTypeOf<boolean>()
      expectTypeOf(commands.has('acme.hello.say-hello')).toEqualTypeOf<boolean>()
      // @ts-expect-error — a number is neither a token nor an id
      commands.has(42)
      // @ts-expect-error — an event token is not a command
      commands.has(defineEvent('acme.hello.greeted'))
    }
    expectTypeOf(unused).toBeFunction()
  })

  it('emits payload-less events without an argument and checks payloads', () => {
    const Refreshed = defineEvent('acme.tasks.refreshed')
    const Paid = defineEvent<Pay>('acme.pay.paid')
    const unused = (events: Events): void => {
      events.emit(Refreshed)
      events.emit(Paid, { amount: 3 })
      events.on(Paid, (payload) => expectTypeOf(payload).toEqualTypeOf<Pay>())
      // @ts-expect-error — a payload-less event takes no payload
      events.emit(Refreshed, 1)
      // @ts-expect-error — a payload event needs its payload
      events.emit(Paid)
      // @ts-expect-error — and of the right type
      events.emit(Paid, { amount: 'three' })
    }
    expectTypeOf(unused).toBeFunction()
  })

  it('subscribes with on and once, and unsubscribes with off, with the token\'s listener type', () => {
    const Refreshed = defineEvent('acme.tasks.refreshed')
    const Paid = defineEvent<Pay>('acme.pay.paid')
    const unused = (events: Events): void => {
      expectTypeOf(events.on(Paid, () => {})).toEqualTypeOf<Disposable>()
      expectTypeOf(events.once(Paid, () => {})).toEqualTypeOf<Disposable>()
      events.once(Paid, (payload) => expectTypeOf(payload).toEqualTypeOf<Pay>())
      events.once(Refreshed, (payload) => expectTypeOf(payload).toEqualTypeOf<void>())
      const onPaid = (payload: Pay): void => void payload.amount
      events.on(Paid, onPaid)
      expectTypeOf(events.off(Paid, onPaid)).toEqualTypeOf<void>()
      // @ts-expect-error — a listener with the wrong payload type
      events.on(Paid, (payload: { amount: string }) => payload.amount)
      // @ts-expect-error — nor with once
      events.once(Paid, (payload: number) => payload)
      // @ts-expect-error — off takes the token's listener type too
      events.off(Paid, (payload: number) => payload)
      // @ts-expect-error — off needs the listener to remove
      events.off(Paid)
    }
    expectTypeOf(unused).toBeFunction()
  })

  it('keeps tokens of different types distinct', () => {
    expectTypeOf<EventToken<Pay>>().not.toExtend<EventToken<number>>()
    expectTypeOf<EventToken<number>>().not.toExtend<EventToken<Pay>>()
    expectTypeOf<CommandToken<[string], string>>().not.toExtend<CommandToken<[number], string>>()
    expectTypeOf<CommandToken<[string], string>>().not.toExtend<CommandToken<[string], number>>()
    const paid = defineEvent<Pay>('acme.pay.paid')
    // @ts-expect-error — an EventToken<Pay> is not an EventToken<number>
    const asNumber: EventToken<number> = paid
    expect(asNumber).toBe(paid)
  })

  it('accepts a structurally equal token built without the helper', () => {
    // A host or another bundle may hold a token literal for an id it only knows as a string.
    const literal = { kind: 'event', id: 'acme.pay.paid' } as const
    const token: EventToken<Pay> = literal
    const command: CommandToken<[name: string], string> = { kind: 'command', id: 'acme.hello.say-hello' }
    expect(token.id).toBe(defineEvent<Pay>('acme.pay.paid').id)
    expect(command.kind).toBe('command')
  })
})

describe('the recording fake', () => {
  it('records on and once listeners by id, and off removes every subscription of that listener', () => {
    const Paid = defineEvent<Pay>('acme.pay.paid')
    const fake = createFakeContext({ id: 'acme.pay', name: 'Pay', version: '1.0.0', engines: { cezar: '^0.11.0' } })
    const first = (): void => {}
    const second = (): void => {}

    fake.context.events.on(Paid, first)
    fake.context.events.once(Paid, first)
    fake.context.events.on(Paid, second)

    expect(fake.listeners.get('acme.pay.paid')?.map((recorded) => [recorded.listener, recorded.once])).toEqual([
      [first, false],
      [first, true],
      [second, false],
    ])

    fake.context.events.off(Paid, first)
    expect(fake.listeners.get('acme.pay.paid')?.map((recorded) => recorded.listener)).toEqual([second])

    fake.context.events.off(Paid, second)
    fake.context.events.off(Paid, second)
    expect(fake.listeners.has('acme.pay.paid')).toBe(false)
  })
})
