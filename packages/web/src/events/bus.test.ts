import { afterEach, describe, expect, it, vi } from 'vitest'

import { defineEvent, isExtensionError, type EventToken } from '@open-mercato/cezar-extension-api'

import { fakeScope } from '../extensions/registry.fixtures'
import { createEventBus, EventError, type EventErrorReport } from './bus'

afterEach(() => {
  vi.restoreAllMocks()
})

interface Task {
  readonly taskId: string
  readonly note?: string
}

const Started = defineEvent<Task>('cezar.test.started')
const Ping = defineEvent('cezar.test.ping')

/** Every report the bus makes, and a bus that records into it. */
function recordingBus(options: { maxCascadeDepth?: number; deliveryBudget?: number } = {}) {
  const reports: EventErrorReport[] = []
  const bus = createEventBus({ ...options, onError: (report) => reports.push(report) })
  return { bus, reports }
}

/** One microtask: enough for the delivery queued by a synchronous emit to drain. */
const flush = () => Promise.resolve()

function thrown(run: () => unknown): EventError {
  try {
    run()
  } catch (error) {
    expect(isExtensionError(error)).toBe(true)
    return error as EventError
  }
  throw new Error('expected a throw')
}

describe('the core view', () => {
  it('delivers after emit returns, never inside it, with the payload', async () => {
    const { bus } = recordingBus()
    const seen: Task[] = []
    bus.on(Started, (task) => seen.push(task))

    bus.emit(Started, { taskId: 't1' })

    expect(seen).toEqual([])
    await flush()
    expect(seen).toEqual([{ taskId: 't1' }])
  })

  it('delivers in subscription order within an emit and in emit order across emits', async () => {
    const { bus } = recordingBus()
    const log: string[] = []
    bus.on(Started, ({ taskId }) => log.push(`first ${taskId}`))
    bus.on(Started, ({ taskId }) => log.push(`second ${taskId}`))

    bus.emit(Started, { taskId: 'a' })
    bus.emit(Started, { taskId: 'b' })
    // Subscribed after both emits: it receives neither.
    bus.on(Started, ({ taskId }) => log.push(`late ${taskId}`))
    await flush()

    expect(log).toEqual(['first a', 'second a', 'first b', 'second b'])
  })

  it('gives every listener its own JSON snapshot, taken when the event is emitted', async () => {
    const { bus } = recordingBus()
    const Noted = defineEvent<{ task: { taskId: string }; tags: string[] }>('cezar.test.noted')
    const received: { task: { taskId: string }; tags: string[] }[] = []
    bus.on(Noted, (payload) => {
      received.push(payload)
      payload.tags.push('mutated by the first listener')
    })
    bus.on(Noted, (payload) => received.push(payload))
    const payload = { task: { taskId: 't1' }, tags: ['a'] }

    bus.emit(Noted, payload)
    payload.task.taskId = 'changed after emit'
    payload.tags.push('b')
    await flush()

    expect(received[0]).not.toBe(received[1])
    expect(received[0]).not.toBe(payload)
    expect(received[1]).toEqual({ task: { taskId: 't1' }, tags: ['a'] })
  })

  it('delivers the JSON projection: functions and undefined fields dropped, a Date as a string', async () => {
    const { bus } = recordingBus()
    const Loose = defineEvent<Record<string, string | undefined>>('cezar.test.loose')
    const received: unknown[] = []
    bus.on(Loose, (payload) => received.push(payload))

    // A JS caller (or a cast) can pass what `IsJson` keeps out of typed code.
    bus.emit(Loose, { at: new Date(0), skipped: undefined, run: (() => 1) as unknown as string, kept: 'yes' } as never)
    await flush()

    expect(received).toEqual([{ at: '1970-01-01T00:00:00.000Z', kept: 'yes' }])
  })

  it('delivers undefined for a payload-less event, without a parse error', async () => {
    const { bus, reports } = recordingBus()
    const received: unknown[] = []
    bus.on(Ping, (payload) => received.push(payload))

    bus.emit(Ping)
    await flush()

    expect(received).toEqual([undefined])
    expect(reports).toEqual([])
  })

  it.each([
    ['a cycle', () => {
      const cyclic: Record<string, unknown> = { taskId: 't1' }
      cyclic.self = cyclic
      return cyclic
    }],
    ['a bigint', () => ({ taskId: 't1', size: 10n })],
  ])('throws invalid-input for %s — naming the event, never the value — and delivers nothing', async (_name, make) => {
    const { bus } = recordingBus()
    const listener = vi.fn()
    bus.on(Started, listener)

    const error = thrown(() => bus.emit(Started, make() as never))
    await flush()

    expect(error).toBeInstanceOf(EventError)
    expect(error.name).toBe('EventError')
    expect(error.code).toBe('invalid-input')
    expect(error.eventId).toBe('cezar.test.started')
    expect(error.message).toBe('The payload of event "cezar.test.started" is not JSON')
    expect(listener).not.toHaveBeenCalled()
  })

  it('isolates a throwing and a rejecting listener: both are reported, and the next still runs', async () => {
    const { bus, reports } = recordingBus()
    const thrownError = new Error('sync failure')
    const rejection = new Error('async failure')
    const after = vi.fn()
    bus.on(Started, () => {
      throw thrownError
    })
    bus.on(Started, async () => {
      throw rejection
    })
    bus.on(Started, after)

    expect(() => bus.emit(Started, { taskId: 't1' })).not.toThrow()
    await vi.waitFor(() => expect(reports).toHaveLength(2))

    expect(after).toHaveBeenCalledWith({ taskId: 't1' })
    expect(reports).toEqual([
      { extensionId: undefined, eventId: 'cezar.test.started', kind: 'listener', error: thrownError },
      { extensionId: undefined, eventId: 'cezar.test.started', kind: 'listener', error: rejection },
    ])
  })

  it('swallows an onError that throws', async () => {
    const bus = createEventBus({
      onError: () => {
        throw new Error('reporter is down')
      },
    })
    const after = vi.fn()
    bus.on(Started, () => {
      throw new Error('listener failure')
    })
    bus.on(Started, after)

    bus.emit(Started, { taskId: 't1' })
    await flush()

    expect(after).toHaveBeenCalledTimes(1)
  })

  it('logs a listener failure as one `[cezar:extensions]` console line by default', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bus = createEventBus()
    const failure = new Error('boom')
    bus.on(Started, () => {
      throw failure
    })

    bus.emit(Started, { taskId: 't1' })
    await flush()

    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]).toEqual(['[cezar:extensions] core: listener for cezar.test.started failed', failure])
  })

  it('refuses a core emit outside `cezar.*` with namespace-violation', () => {
    const { bus } = recordingBus()

    const error = thrown(() => bus.emit(defineEvent('acme.alpha.ready')))

    expect(error.code).toBe('namespace-violation')
    expect(error.eventId).toBe('acme.alpha.ready')
  })

  it.each([
    ['null', null],
    ['a string', 'cezar.test.started'],
    ['a command token', { kind: 'command', id: 'cezar.test.started' }],
    ['an invalid id', { kind: 'event', id: 'Cezar.Test' }],
    ['a throwing getter', Object.defineProperty({ kind: 'event' }, 'id', { get: () => { throw new Error('getter') } })],
  ])('throws invalid-id for %s, from emit and on', (_name, token) => {
    const { bus } = recordingBus()

    expect(thrown(() => bus.emit(token as EventToken<void>)).code).toBe('invalid-id')
    expect(thrown(() => bus.on(token as EventToken<void>, () => {})).code).toBe('invalid-id')
  })

  it('throws invalid-input for a listener that is not a function', () => {
    const { bus } = recordingBus()

    const error = thrown(() => bus.on(Started, 'listener' as never))

    expect(error.code).toBe('invalid-input')
    expect(error.message).toBe('The listener for event "cezar.test.started" is not a function')
  })

  it('stops calling a listener once its Disposable is disposed — even for an emit already queued', async () => {
    const { bus } = recordingBus()
    const listener = vi.fn()
    const subscription = bus.on(Started, listener)

    bus.emit(Started, { taskId: 'queued' })
    subscription.dispose()
    subscription.dispose()
    bus.emit(Started, { taskId: 'later' })
    await flush()

    expect(listener).not.toHaveBeenCalled()
  })

  it('drops a synchronous re-emit past maxCascadeDepth with exactly one cascade report', async () => {
    const { bus, reports } = recordingBus()
    let deliveries = 0
    bus.on(Ping, () => {
      deliveries += 1
      bus.emit(Ping)
    })

    bus.emit(Ping)
    await vi.waitFor(() => expect(reports).toHaveLength(1))

    // Depth 0 (the first emit) through 16 are delivered; the emit at depth 17 is dropped.
    expect(deliveries).toBe(17)
    expect(reports[0]).toMatchObject({ extensionId: undefined, eventId: 'cezar.test.ping', kind: 'cascade' })
    expect(reports[0]?.error).toBeInstanceOf(Error)
  })

  it('reports a synchronous fan-out’s dropped emits once per streak, not once per drop', async () => {
    const { bus, reports } = recordingBus({ maxCascadeDepth: 5 })
    let deliveries = 0
    bus.on(Ping, () => {
      deliveries += 1
      bus.emit(Ping)
      bus.emit(Ping)
    })

    bus.emit(Ping)
    await vi.waitFor(() => expect(deliveries).toBe(63))
    // A quiet macrotask ends the streak; the next runaway chain is reported again.
    await new Promise((resolve) => setTimeout(resolve, 20))
    bus.emit(Ping)
    await vi.waitFor(() => expect(deliveries).toBe(126))

    // Depths 0–5 are delivered (2^6 − 1 calls per chain); the 64 emits at depth 6 are dropped.
    expect(reports.filter((report) => report.kind === 'cascade')).toHaveLength(2)
  })

  it('honours a custom maxCascadeDepth, and an emit outside any listener starts again at depth 0', async () => {
    const { bus, reports } = recordingBus({ maxCascadeDepth: 2 })
    let deliveries = 0
    bus.on(Ping, () => {
      deliveries += 1
      bus.emit(Ping)
    })

    bus.emit(Ping)
    await vi.waitFor(() => expect(reports).toHaveLength(1))
    bus.emit(Ping)
    await vi.waitFor(() => expect(reports).toHaveLength(2))

    expect(deliveries).toBe(6)
  })
})

describe('the delivery budget', () => {
  /** A storm that stops on its own after this many calls, so a broken budget fails instead of hanging. */
  const RUNAWAY = 100_000

  it('lets a timer scheduled before an async ping-pong fire while the ping-pong still runs', async () => {
    const { bus, reports } = recordingBus({ deliveryBudget: 50 })
    let calls = 0
    let callsWhenTimerFired: number | undefined
    let stopAt = RUNAWAY
    bus.on(Ping, async () => {
      calls += 1
      await Promise.resolve()
      if (calls < stopAt) bus.emit(Ping)
    })
    setTimeout(() => {
      callsWhenTimerFired = calls
      stopAt = calls + 200
    }, 0)

    bus.emit(Ping)
    await vi.waitFor(() => expect(callsWhenTimerFired).toBeDefined())
    // Still running after the timer, and not only up to the next pause: the storm continued.
    await vi.waitFor(() => expect(calls).toBe(stopAt))

    expect(callsWhenTimerFired).toBeLessThan(RUNAWAY)
    expect(reports.filter((report) => report.kind === 'backlog')).toHaveLength(1)
  })

  it('lets a timer scheduled before a 2× fan-out fire while the fan-out still runs', async () => {
    const { bus } = recordingBus({ deliveryBudget: 50, maxCascadeDepth: RUNAWAY })
    let calls = 0
    let callsWhenTimerFired: number | undefined
    let stopped = false
    bus.on(Ping, () => {
      calls += 1
      if (stopped || calls >= RUNAWAY) return
      bus.emit(Ping)
      bus.emit(Ping)
    })
    setTimeout(() => {
      callsWhenTimerFired = calls
      stopped = true
    }, 0)

    bus.emit(Ping)
    await vi.waitFor(() => expect(callsWhenTimerFired).toBeDefined())
    // The deliveries queued before the timer are still delivered after it: the fan-out was
    // still running when the timer fired.
    await vi.waitFor(() => expect(calls).toBeGreaterThan(callsWhenTimerFired as number))

    expect(callsWhenTimerFired).toBeLessThan(RUNAWAY)
  })

  it('reports one backlog per streak, and again for a later storm', async () => {
    const { bus, reports } = recordingBus({ deliveryBudget: 5 })
    const received: number[] = []
    const Numbered = defineEvent<number>('cezar.test.numbered')
    bus.on(Numbered, (n) => received.push(n))

    for (let n = 0; n < 23; n += 1) bus.emit(Numbered, n)
    await vi.waitFor(() => expect(received).toHaveLength(23))
    // A quiet macrotask period ends the streak.
    await new Promise((resolve) => setTimeout(resolve, 20))
    for (let n = 23; n < 34; n += 1) bus.emit(Numbered, n)
    await vi.waitFor(() => expect(received).toHaveLength(34))

    const backlog = reports.filter((report) => report.kind === 'backlog')
    expect(backlog).toHaveLength(2)
    expect(backlog[0]).toMatchObject({ extensionId: undefined, eventId: 'cezar.test.numbered' })
  })

  it('yields after the default budget of 1,000 listener calls', async () => {
    const { bus, reports } = recordingBus()
    const received: number[] = []
    const Numbered = defineEvent<number>('cezar.test.numbered')
    bus.on(Numbered, (n) => received.push(n))

    for (let n = 0; n < 1_001; n += 1) bus.emit(Numbered, n)
    await flush()

    expect(received).toHaveLength(1_000)
    expect(reports.map((report) => report.kind)).toEqual(['backlog'])
    await vi.waitFor(() => expect(received).toHaveLength(1_001))
    expect(received.at(-1)).toBe(1_000)
  })

  it('ends a streak even when the resumed drain finds only cancelled deliveries', async () => {
    const { bus, reports } = recordingBus({ deliveryBudget: 3 })
    const Numbered = defineEvent<number>('cezar.test.numbered')
    const alpha = fakeScope('acme.alpha')
    bus.forExtension(alpha.scope).on(Numbered, () => {})

    for (let n = 0; n < 5; n += 1) bus.emit(Numbered, n)
    await flush()
    // Paused with two deliveries left, both cancelled before the drain resumes.
    alpha.end()
    await new Promise((resolve) => setTimeout(resolve, 20))

    const received: number[] = []
    bus.on(Numbered, (n) => received.push(n))
    for (let n = 0; n < 5; n += 1) bus.emit(Numbered, n)
    await vi.waitFor(() => expect(received).toHaveLength(5))

    // The second storm is a new streak, so it is reported too.
    expect(reports.filter((report) => report.kind === 'backlog')).toHaveLength(2)
  })

  it('preserves emit order across a pause', async () => {
    const { bus } = recordingBus({ deliveryBudget: 3 })
    const received: string[] = []
    const Numbered = defineEvent<number>('cezar.test.numbered')
    bus.on(Numbered, (n) => received.push(`a${n}`))
    bus.on(Numbered, (n) => received.push(`b${n}`))

    for (let n = 0; n < 5; n += 1) bus.emit(Numbered, n)
    await flush()
    // Paused after three calls: the rest waits for the next macrotask, in order.
    expect(received).toEqual(['a0', 'b0', 'a1'])
    await vi.waitFor(() => expect(received).toHaveLength(10))

    expect(received).toEqual(['a0', 'b0', 'a1', 'b1', 'a2', 'b2', 'a3', 'b3', 'a4', 'b4'])
  })
})

describe('the extension view', () => {
  const AlphaReady = defineEvent<{ step: number }>('acme.alpha.ready')
  const BetaReady = defineEvent<{ step: number }>('acme.beta.ready')

  it('DoD 1: an extension subscribes to a core event and receives a core emit', async () => {
    const { bus } = recordingBus()
    const alpha = fakeScope('acme.alpha')
    const events = bus.forExtension(alpha.scope)
    const seen: Task[] = []

    events.on(Started, (task) => seen.push(task))
    bus.emit(Started, { taskId: 't1' })
    await flush()

    expect(seen).toEqual([{ taskId: 't1' }])
    expect(alpha.tracked.size).toBe(1)
  })

  describe('DoD 2: unsubscribing', () => {
    it('never calls a listener again after off', async () => {
      const { bus } = recordingBus()
      const events = bus.forExtension(fakeScope('acme.alpha').scope)
      const listener = vi.fn()
      events.on(Started, listener)
      bus.emit(Started, { taskId: 'before' })
      await flush()

      events.off(Started, listener)
      bus.emit(Started, { taskId: 'after' })
      await flush()

      expect(listener.mock.calls).toEqual([[{ taskId: 'before' }]])
    })

    it('removes both of two duplicate subscriptions with one off; each Disposable removes one', async () => {
      const { bus } = recordingBus()
      const alpha = fakeScope('acme.alpha')
      const events = bus.forExtension(alpha.scope)
      const listener = vi.fn()

      const first = events.on(Started, listener)
      events.on(Started, listener)
      bus.emit(Started, { taskId: 'twice' })
      await flush()
      expect(listener).toHaveBeenCalledTimes(2)

      first.dispose()
      bus.emit(Started, { taskId: 'once' })
      await flush()
      expect(listener).toHaveBeenCalledTimes(3)

      events.on(Started, listener)
      events.off(Started, listener)
      bus.emit(Started, { taskId: 'never' })
      await flush()
      expect(listener).toHaveBeenCalledTimes(3)
      expect(alpha.tracked.size).toBe(0)
    })

    it('skips a delivery already queued when off, or the Disposable, runs before the flush', async () => {
      const { bus } = recordingBus()
      const events = bus.forExtension(fakeScope('acme.alpha').scope)
      const offed = vi.fn()
      const disposed = vi.fn()
      events.on(Started, offed)
      const subscription = events.on(Started, disposed)

      bus.emit(Started, { taskId: 'queued' })
      events.off(Started, offed)
      subscription.dispose()
      subscription.dispose()
      await flush()

      expect(offed).not.toHaveBeenCalled()
      expect(disposed).not.toHaveBeenCalled()
    })

    it('treats off of an unknown listener, or one never subscribed to that event, as a no-op', async () => {
      const { bus } = recordingBus()
      const events = bus.forExtension(fakeScope('acme.alpha').scope)
      const listener = vi.fn()
      events.on(Started, listener)

      expect(() => events.off(Started, () => {})).not.toThrow()
      expect(() => events.off(Ping, listener)).not.toThrow()
      expect(() => events.off(Started, 'not a function' as never)).not.toThrow()
      bus.emit(Started, { taskId: 't1' })
      await flush()

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('leaves another extension’s subscription alone, even when it uses the same function', async () => {
      const { bus } = recordingBus()
      const alpha = bus.forExtension(fakeScope('acme.alpha').scope)
      const beta = bus.forExtension(fakeScope('acme.beta').scope)
      const shared = vi.fn()
      alpha.on(Started, shared)
      beta.on(Started, shared)

      alpha.off(Started, shared)
      bus.emit(Started, { taskId: 't1' })
      await flush()

      expect(shared).toHaveBeenCalledTimes(1)
    })

    it('fires a once listener for the first emit only, and untracks it once delivered', async () => {
      const { bus } = recordingBus()
      const alpha = fakeScope('acme.alpha')
      const events = bus.forExtension(alpha.scope)
      const listener = vi.fn()

      events.once(Started, listener)
      bus.emit(Started, { taskId: 'first' })
      bus.emit(Started, { taskId: 'second' })
      await flush()

      expect(listener.mock.calls).toEqual([[{ taskId: 'first' }]])
      expect(alpha.tracked.size).toBe(0)
    })

    it('never fires a once disposed before delivery', async () => {
      const { bus } = recordingBus()
      const events = bus.forExtension(fakeScope('acme.alpha').scope)
      const listener = vi.fn()

      const subscription = events.once(Started, listener)
      subscription.dispose()
      bus.emit(Started, { taskId: 't1' })
      await flush()

      expect(listener).not.toHaveBeenCalled()
    })

    it('cancels a pending once with off between the emit and the flush', async () => {
      const { bus } = recordingBus()
      const alpha = fakeScope('acme.alpha')
      const events = bus.forExtension(alpha.scope)
      const listener = vi.fn()

      events.once(Started, listener)
      bus.emit(Started, { taskId: 't1' })
      events.off(Started, listener)
      await flush()

      expect(listener).not.toHaveBeenCalled()
      expect(alpha.tracked.size).toBe(0)
    })
  })

  describe('DoD 3: owned namespaces', () => {
    it('lets an extension emit under its own id, and refuses cezar.*, another extension and a look-alike', () => {
      const { bus } = recordingBus()
      const events = bus.forExtension(fakeScope('acme.alpha').scope)

      expect(() => events.emit(AlphaReady, { step: 1 })).not.toThrow()
      for (const foreign of [BetaReady, defineEvent<Task>('cezar.task.started'), defineEvent('acme.alphabet.ready')]) {
        const error = thrown(() => events.emit(foreign as EventToken<{ step: number }>, { step: 1 }))
        expect(error.code).toBe('namespace-violation')
        expect(error.eventId).toBe(foreign.id)
      }
    })

    it('refuses a cezar.* emit even from an extension whose own id is under cezar', () => {
      const { bus } = recordingBus()
      const events = bus.forExtension(fakeScope('cezar.task').scope)

      const error = thrown(() => events.emit(defineEvent<Task>('cezar.task.started'), { taskId: 't1' }))

      expect(error.code).toBe('namespace-violation')
      expect(error.message).toBe('Extension "cezar.task" may not emit core event "cezar.task.started"')
    })

    it('delivers each extension’s event only to the listeners of that event', async () => {
      const { bus } = recordingBus()
      const alpha = bus.forExtension(fakeScope('acme.alpha').scope)
      const beta = bus.forExtension(fakeScope('acme.beta').scope)
      const watcher = bus.forExtension(fakeScope('acme.watcher').scope)
      const log: string[] = []
      watcher.on(AlphaReady, ({ step }) => log.push(`alpha ${step}`))
      watcher.on(BetaReady, ({ step }) => log.push(`beta ${step}`))

      alpha.emit(AlphaReady, { step: 1 })
      beta.emit(BetaReady, { step: 2 })
      await flush()

      expect(log).toEqual(['alpha 1', 'beta 2'])
    })

    it('reports a failing extension listener under its own extension, and a cascade under the emitter', async () => {
      const { bus, reports } = recordingBus({ maxCascadeDepth: 0 })
      const alpha = bus.forExtension(fakeScope('acme.alpha').scope)
      const beta = bus.forExtension(fakeScope('acme.beta').scope)
      const failure = new Error('beta broke')
      beta.on(AlphaReady, () => {
        throw failure
      })
      alpha.on(AlphaReady, () => alpha.emit(AlphaReady, { step: 2 }))

      alpha.emit(AlphaReady, { step: 1 })
      await flush()

      expect(reports.map(({ extensionId, eventId, kind }) => [extensionId, eventId, kind])).toEqual([
        ['acme.beta', 'acme.alpha.ready', 'listener'],
        ['acme.alpha', 'acme.alpha.ready', 'cascade'],
      ])
      expect(reports[0]?.error).toBe(failure)
    })
  })

  describe('DoD 4: the scope ends', () => {
    it('tracks every subscription and drops them all when the scope ends', async () => {
      const { bus } = recordingBus()
      const alpha = fakeScope('acme.alpha')
      const events = bus.forExtension(alpha.scope)
      const listener = vi.fn()
      events.on(Started, listener)
      events.once(Ping, listener)
      events.on(AlphaReady, listener)
      expect(alpha.tracked.size).toBe(3)

      alpha.end()
      bus.emit(Started, { taskId: 't1' })
      bus.emit(Ping)
      bus.forExtension(fakeScope('acme.alpha').scope).emit(AlphaReady, { step: 1 })
      await flush()

      expect(listener).not.toHaveBeenCalled()
      expect(alpha.tracked.size).toBe(0)
    })

    it('cancels a pending once when the scope ends — it has already left the event’s list', async () => {
      const { bus } = recordingBus()
      const alpha = fakeScope('acme.alpha')
      const listener = vi.fn()
      bus.forExtension(alpha.scope).once(Started, listener)

      bus.emit(Started, { taskId: 'pending' })
      alpha.end()
      await flush()

      expect(listener).not.toHaveBeenCalled()
      expect(alpha.tracked.size).toBe(0)
    })

    it('does not deliver an event emitted just before the scope ends', async () => {
      const { bus } = recordingBus()
      const alpha = fakeScope('acme.alpha')
      const listener = vi.fn()
      bus.forExtension(alpha.scope).on(Started, listener)

      bus.emit(Started, { taskId: 'just before' })
      alpha.end()
      await flush()

      expect(listener).not.toHaveBeenCalled()
    })

    it('throws disposed from every method afterwards', () => {
      const { bus } = recordingBus()
      const alpha = fakeScope('acme.alpha')
      const events = bus.forExtension(alpha.scope)
      alpha.end()

      for (const call of [
        () => events.on(Started, () => {}),
        () => events.once(Started, () => {}),
        () => events.off(Started, () => {}),
        () => events.emit(AlphaReady, { step: 1 }),
      ]) {
        expect(thrown(call).code).toBe('disposed')
      }
    })
  })

  it('checks the token before the listener, like the core view', () => {
    const { bus } = recordingBus()
    const events = bus.forExtension(fakeScope('acme.alpha').scope)

    expect(thrown(() => events.on({ kind: 'event', id: 'Bad' } as never, 'nope' as never)).code).toBe('invalid-id')
    expect(thrown(() => events.once(Started, 'nope' as never)).code).toBe('invalid-input')
    expect(thrown(() => events.off(null as never, () => {})).code).toBe('invalid-id')
    expect(thrown(() => events.emit('acme.alpha.ready' as unknown as EventToken<void>)).code).toBe('invalid-id')
  })
})
