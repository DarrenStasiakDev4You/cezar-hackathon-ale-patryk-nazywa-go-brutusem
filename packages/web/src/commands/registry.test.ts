import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { defineCommand, isExtensionError, type CommandToken } from '@open-mercato/cezar-extension-api'

import { CommandError, createCommandRegistry, type CoreCommandOptions } from './registry'

interface Echo {
  readonly text: string
}

const EchoCommand = defineCommand<[input: Echo], { echoed: string }>('cezar.test.echo')
const Hidden = defineCommand<[input: Echo], string>('cezar.test.hidden')

/** A validator in the house style: names the field and the rule, never the value. */
function validateEcho(args: readonly unknown[]): [Echo] {
  const [input] = args
  if (typeof input !== 'object' || input === null) throw new Error('expected one input object')
  const { text } = input as { text?: unknown }
  if (typeof text !== 'string') throw new Error('text must be a string')
  return [{ text }]
}

const publicEcho: CoreCommandOptions<[Echo]> = { visibility: 'public', validate: validateEcho }

/** The rejection of `promise` — the test fails when it resolves. */
async function rejection(promise: Promise<unknown>): Promise<CommandError> {
  const outcome = await promise.then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  )
  if (outcome.ok) throw new Error('expected a rejection')
  expect(isExtensionError(outcome.error)).toBe(true)
  return outcome.error as CommandError
}

function thrown(run: () => unknown): CommandError {
  try {
    run()
  } catch (error) {
    expect(isExtensionError(error)).toBe(true)
    return error as CommandError
  }
  throw new Error('expected a throw')
}

describe('core registration and execution', () => {
  it('registers, executes with a typed result, and forgets the command once disposed', async () => {
    const registry = createCommandRegistry()
    const registration = registry.register(EchoCommand, ({ text }) => ({ echoed: text }), publicEcho)

    expect(registry.has(EchoCommand)).toBe(true)
    expect(registry.has('cezar.test.echo')).toBe(true)
    await expect(registry.execute(EchoCommand, { text: 'hi' })).resolves.toEqual({ echoed: 'hi' })

    registration.dispose()
    registration.dispose()

    expect(registry.has(EchoCommand)).toBe(false)
    expect((await rejection(registry.execute(EchoCommand, { text: 'hi' }))).code).toBe('command-not-found')
  })

  it('answers command-not-found for an unknown id — even with nothing registered, never a TypeError', async () => {
    const registry = createCommandRegistry()

    const error = await rejection(registry.execute(EchoCommand, { text: 'hi' }))

    expect(error).toBeInstanceOf(CommandError)
    expect(error.name).toBe('CommandError')
    expect(error.code).toBe('command-not-found')
    expect(error.commandId).toBe('cezar.test.echo')
    expect(error.message).toBe('Command "cezar.test.echo" not found')
  })

  it.each([
    ['null', null],
    ['a string', 'cezar.test.echo'],
    ['an event token', { kind: 'event', id: 'cezar.test.echo' }],
    ['an invalid id', { kind: 'command', id: 'Cezar Echo' }],
    ['a number id', { kind: 'command', id: 42 }],
    [
      'a throwing getter',
      Object.defineProperty({ kind: 'command' }, 'id', {
        get() {
          throw new Error('boom')
        },
      }),
    ],
  ])('treats %s as a malformed token: execute rejects invalid-id, has is false, register throws', async (_label, token) => {
    const registry = createCommandRegistry()
    const bad = token as unknown as CommandToken<[input: Echo], { echoed: string }>

    const executed = registry.execute(bad, { text: 'hi' })
    expect(executed).toBeInstanceOf(Promise)
    const error = await rejection(executed)
    expect(error.code).toBe('invalid-id')
    expect(error.commandId).toBeUndefined()

    expect(registry.has(bad)).toBe(false)
    expect(thrown(() => registry.register(bad, () => ({ echoed: '' }), publicEcho)).code).toBe('invalid-id')
  })

  it('refuses input the validator throws on — invalid-input, and the handler never runs', async () => {
    const registry = createCommandRegistry()
    const handler = vi.fn(() => ({ echoed: '' }))
    registry.register(EchoCommand, handler, publicEcho)

    const error = await rejection(registry.execute(EchoCommand, { text: 42 } as unknown as Echo))

    expect(error.code).toBe('invalid-input')
    expect(error.commandId).toBe('cezar.test.echo')
    expect(error.message).toBe('Invalid input for cezar.test.echo: text must be a string')
    expect(error.cause).toBeInstanceOf(Error)
    expect(handler).not.toHaveBeenCalled()
  })

  it('refuses a validator that does not return an argument list', async () => {
    const registry = createCommandRegistry()
    const handler = vi.fn(() => ({ echoed: '' }))
    registry.register(EchoCommand, handler, {
      visibility: 'public',
      validate: () => ({ text: 'not a tuple' }) as unknown as [Echo],
    })

    expect((await rejection(registry.execute(EchoCommand, { text: 'hi' }))).code).toBe('invalid-input')
    expect(handler).not.toHaveBeenCalled()
  })

  it("hands the handler the validator's value, not the caller's objects", async () => {
    const registry = createCommandRegistry()
    let received: unknown
    registry.register(
      EchoCommand,
      (input) => {
        received = input
        return { echoed: input.text }
      },
      publicEcho,
    )
    const callers = { text: 'hi', extra: 'ignored' }

    await registry.execute(EchoCommand, callers)

    expect(received).toEqual({ text: 'hi' })
    expect(received).not.toBe(callers)
  })

  it.each([
    [
      'a synchronous throw',
      () => {
        throw new Error('sync boom')
      },
      'sync boom',
    ],
    ['a rejection', () => Promise.reject(new Error('async boom')), 'async boom'],
    ['a thrown string', () => Promise.reject('plain words'), 'plain words'],
    [
      'a coded error of its own',
      () => {
        throw Object.assign(new Error('not found downstream'), { code: 'command-not-found' })
      },
      'not found downstream',
    ],
  ])('turns %s in the handler into command-failed with the original as cause', async (_label, fail, message) => {
    const registry = createCommandRegistry()
    registry.register(EchoCommand, fail as () => never, publicEcho)

    const error = await rejection(registry.execute(EchoCommand, { text: 'hi' }))

    expect(error.code).toBe('command-failed')
    expect(error.commandId).toBe('cezar.test.echo')
    expect(error.message).toBe(message)
    expect(error.cause === message || (error.cause as Error).message === message).toBe(true)
  })

  it('refuses a core id outside cezar.* with namespace-violation', () => {
    const registry = createCommandRegistry()
    const Foreign = defineCommand<[input: Echo], string>('acme.test.echo')

    const error = thrown(() => registry.register(Foreign, () => '', { visibility: 'public', validate: validateEcho }))

    expect(error.code).toBe('namespace-violation')
    expect(registry.has(Foreign)).toBe(false)
  })

  it('refuses a duplicate and leaves the first registration untouched', async () => {
    const registry = createCommandRegistry()
    registry.register(EchoCommand, () => ({ echoed: 'first' }), publicEcho)

    const error = thrown(() => registry.register(EchoCommand, () => ({ echoed: 'second' }), publicEcho))

    expect(error.code).toBe('duplicate-registration')
    await expect(registry.execute(EchoCommand, { text: 'hi' })).resolves.toEqual({ echoed: 'first' })
  })

  it('a stale Disposable leaves a newer registration of the same id alone', async () => {
    const registry = createCommandRegistry()
    const first = registry.register(EchoCommand, () => ({ echoed: 'first' }), publicEcho)
    first.dispose()
    registry.register(EchoCommand, () => ({ echoed: 'second' }), publicEcho)

    first.dispose()

    await expect(registry.execute(EchoCommand, { text: 'hi' })).resolves.toEqual({ echoed: 'second' })
  })

  it('refuses a handler or validator that is not a function, and a missing visibility, with invalid-input', () => {
    const registry = createCommandRegistry()
    const cases = [
      () => registry.register(EchoCommand, 'nope' as never, publicEcho),
      () => registry.register(EchoCommand, () => ({ echoed: '' }), { visibility: 'public' } as never),
      () => registry.register(EchoCommand, () => ({ echoed: '' }), { validate: validateEcho } as never),
      () => registry.register(EchoCommand, () => ({ echoed: '' }), undefined as never),
    ]

    for (const register of cases) expect(thrown(register).code).toBe('invalid-input')
    expect(registry.has(EchoCommand)).toBe(false)
  })

  it('sees internal commands from the core view', async () => {
    const registry = createCommandRegistry()
    registry.register(Hidden, ({ text }) => text.toUpperCase(), { visibility: 'internal', validate: validateEcho })

    expect(registry.has(Hidden)).toBe(true)
    await expect(registry.execute(Hidden, { text: 'hi' })).resolves.toBe('HI')
  })
})

// Type tests: checked by `npm run typecheck`, never executed.
describe('types', () => {
  it('checks input and result types against the token', () => {
    const unused = (): void => {
      const registry = createCommandRegistry()
      registry.register(EchoCommand, (input) => {
        expectTypeOf(input).toEqualTypeOf<Echo>()
        return { echoed: input.text }
      }, publicEcho)
      expectTypeOf(registry.execute(EchoCommand, { text: 'hi' })).toEqualTypeOf<Promise<{ echoed: string }>>()
      // @ts-expect-error — wrong input type
      void registry.execute(EchoCommand, { text: 42 })
      // @ts-expect-error — missing input
      void registry.execute(EchoCommand)
      // @ts-expect-error — the handler's result must match the token
      registry.register(EchoCommand, () => 'plain', publicEcho)
      // @ts-expect-error — the validator must return the token's argument tuple
      registry.register(EchoCommand, () => ({ echoed: '' }), { visibility: 'public', validate: () => [42] as [number] })
      // @ts-expect-error — visibility has no default
      registry.register(EchoCommand, () => ({ echoed: '' }), { validate: validateEcho })
    }
    expectTypeOf(unused).toBeFunction()
  })
})
