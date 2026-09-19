import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import { defineCommand, isExtensionError, type CommandToken } from '@open-mercato/cezar-extension-api'

import { fakeScope } from '../extensions/registry.fixtures'
import { CommandError, createCommandRegistry, type CoreCommandOptions } from './registry'

afterEach(() => {
  vi.useRealTimers()
})

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

const AlphaPing = defineCommand<[count: number], string>('acme.alpha.ping')
const BetaPing = defineCommand<[count: number], string>('acme.beta.ping')

describe('the extension view', () => {
  it('registers only in its own namespace, through scope.track, and forgets it when the scope ends', async () => {
    const registry = createCommandRegistry()
    const alpha = fakeScope('acme.alpha')
    const commands = registry.forExtension(alpha.scope)

    commands.register(AlphaPing, (count) => `pong ${count}`, { title: 'Alpha: ping' })

    expect(alpha.tracked.size).toBe(1)
    expect(commands.has(AlphaPing)).toBe(true)
    await expect(commands.execute(AlphaPing, 2)).resolves.toBe('pong 2')
    for (const foreign of [BetaPing, defineCommand<[count: number], string>('cezar.task.ping')]) {
      expect(thrown(() => commands.register(foreign, () => '')).code).toBe('namespace-violation')
    }
    // A look-alike prefix is another namespace: `acme.alphabet.*` is not `acme.alpha.*`.
    const lookAlike = defineCommand('acme.alphabet.ping')
    expect(thrown(() => commands.register(lookAlike, () => {})).code).toBe('namespace-violation')
    expect(thrown(() => commands.register({ kind: 'command', id: 'Bad' } as never, () => {})).code).toBe('invalid-id')
    expect(thrown(() => commands.register(AlphaPing, 'nope' as never)).code).toBe('invalid-input')

    alpha.end()

    expect(registry.has(AlphaPing)).toBe(false)
    const other = registry.forExtension(fakeScope('acme.beta').scope)
    expect((await rejection(other.execute(AlphaPing, 1))).code).toBe('command-not-found')
  })

  it('refuses an id another extension holds — the first registration wins', async () => {
    const registry = createCommandRegistry()
    const first = registry.forExtension(fakeScope('acme.alpha').scope)
    const second = registry.forExtension(fakeScope('acme.alpha').scope)
    first.register(AlphaPing, () => 'first')

    expect(thrown(() => second.register(AlphaPing, () => 'second')).code).toBe('duplicate-registration')
    await expect(second.execute(AlphaPing, 1)).resolves.toBe('first')
  })

  it('runs public core commands and other extensions’ commands, and cannot see an internal core one', async () => {
    const registry = createCommandRegistry()
    registry.register(EchoCommand, ({ text }) => ({ echoed: text }), publicEcho)
    registry.register(Hidden, ({ text }) => text, { visibility: 'internal', validate: validateEcho })
    registry.forExtension(fakeScope('acme.beta').scope).register(BetaPing, (count) => `beta ${count}`)
    const alpha = registry.forExtension(fakeScope('acme.alpha').scope)

    await expect(alpha.execute(EchoCommand, { text: 'hi' })).resolves.toEqual({ echoed: 'hi' })
    await expect(alpha.execute(BetaPing, 3)).resolves.toBe('beta 3')
    expect(alpha.has(EchoCommand)).toBe(true)
    expect(alpha.has('acme.beta.ping')).toBe(true)

    // The same answer as for an id nobody registered.
    expect(alpha.has(Hidden)).toBe(false)
    expect(alpha.has('cezar.test.hidden')).toBe(false)
    const error = await rejection(alpha.execute(Hidden, { text: 'hi' }))
    expect(error.code).toBe('command-not-found')
    expect(error.message).toBe('Command "cezar.test.hidden" not found')
    // Core still sees everything.
    expect(registry.has(BetaPing)).toBe(true)
    await expect(registry.execute(BetaPing, 4)).resolves.toBe('beta 4')
  })

  it('validates a public core command’s input for an extension caller too', async () => {
    const registry = createCommandRegistry()
    const handler = vi.fn(() => ({ echoed: '' }))
    registry.register(EchoCommand, handler, publicEcho)
    const alpha = registry.forExtension(fakeScope('acme.alpha').scope)

    expect((await rejection(alpha.execute(EchoCommand, null as unknown as Echo))).code).toBe('invalid-input')
    expect(handler).not.toHaveBeenCalled()
  })

  it('turns an extension handler’s throw into command-failed for the caller', async () => {
    const registry = createCommandRegistry()
    registry.forExtension(fakeScope('acme.beta').scope).register(BetaPing, () => {
      throw new Error('beta broke')
    })

    const error = await rejection(registry.forExtension(fakeScope('acme.alpha').scope).execute(BetaPing, 1))

    expect(error.code).toBe('command-failed')
    expect(error.message).toBe('beta broke')
  })

  it('fails every call with `disposed` once the calling scope has ended', async () => {
    const registry = createCommandRegistry()
    registry.register(EchoCommand, ({ text }) => ({ echoed: text }), publicEcho)
    const alpha = fakeScope('acme.alpha')
    const commands = registry.forExtension(alpha.scope)

    alpha.end()

    const executed = commands.execute(EchoCommand, { text: 'hi' })
    expect(executed).toBeInstanceOf(Promise)
    expect(isExtensionError(await executed.catch((error: unknown) => error), 'disposed')).toBe(true)
    for (const call of [() => commands.has(EchoCommand), () => commands.register(AlphaPing, () => '')]) {
      expect(thrown(call).code).toBe('disposed')
    }
    expect(registry.has(AlphaPing)).toBe(false)
  })

  it('lets a running call settle when its provider deactivates, and answers command-not-found afterwards', async () => {
    const registry = createCommandRegistry()
    const beta = fakeScope('acme.beta')
    let finish!: (value: string) => void
    registry.forExtension(beta.scope).register(BetaPing, () => new Promise<string>((resolve) => (finish = resolve)))
    const alpha = registry.forExtension(fakeScope('acme.alpha').scope)

    const running = alpha.execute(BetaPing, 1)
    await Promise.resolve()
    beta.end()
    finish('late but fine')

    await expect(running).resolves.toBe('late but fine')
    expect((await rejection(alpha.execute(BetaPing, 1))).code).toBe('command-not-found')
  })

  it('times out an extension handler that never settles, and ignores its late result', async () => {
    vi.useFakeTimers()
    const registry = createCommandRegistry({ timeoutMs: 50 })
    let fail!: (error: Error) => void
    registry.forExtension(fakeScope('acme.beta').scope).register(
      BetaPing,
      () => new Promise<string>((_resolve, reject) => (fail = reject)),
    )
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    try {
      const outcome = registry.execute(BetaPing, 1).catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(49)
      let settled = false
      void outcome.then(() => (settled = true))
      await Promise.resolve()
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)

      const error = (await outcome) as CommandError
      expect(isExtensionError(error, 'command-timeout')).toBe(true)
      expect(error.message).toBe('Command "acme.beta.ping" did not finish within 50 ms')

      // The handler gives up after the caller has: that late failure must go nowhere — no
      // unhandled rejection, no second answer.
      fail(new Error('too late'))
      vi.useRealTimers()
      for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('limits extension handlers to 30 s by default', async () => {
    vi.useFakeTimers()
    const registry = createCommandRegistry()
    registry.forExtension(fakeScope('acme.beta').scope).register(BetaPing, () => new Promise<string>(() => {}))

    const outcome = registry.execute(BetaPing, 1).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(29_999)
    let settled = false
    void outcome.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    expect(isExtensionError(await outcome, 'command-timeout')).toBe(true)
  })

  it('never cuts off a core handler, however slow', async () => {
    vi.useFakeTimers()
    const registry = createCommandRegistry({ timeoutMs: 50 })
    registry.register(
      EchoCommand,
      ({ text }) => new Promise<{ echoed: string }>((resolve) => setTimeout(() => resolve({ echoed: text }), 500)),
      publicEcho,
    )

    const outcome = registry.forExtension(fakeScope('acme.alpha').scope).execute(EchoCommand, { text: 'slow' })
    await vi.advanceTimersByTimeAsync(500)

    await expect(outcome).resolves.toEqual({ echoed: 'slow' })
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
      // @ts-expect-error — and may not be WIDER than it: `string | Result` is not `Result`
      registry.register(EchoCommand, (input) => (input.text === '' ? 'plain' : { echoed: input.text }), publicEcho)
      // @ts-expect-error — the validator must return the token's argument tuple
      registry.register(EchoCommand, () => ({ echoed: '' }), { visibility: 'public', validate: () => [42] as [number] })
      // @ts-expect-error — visibility has no default
      registry.register(EchoCommand, () => ({ echoed: '' }), { validate: validateEcho })
    }
    expectTypeOf(unused).toBeFunction()
  })
})
