import {
  isValidContributionId,
  type ContributionId,
  type Disposable,
  type Events,
  type EventToken,
  type ExtensionErrorCode,
  type ExtensionId,
} from '@open-mercato/cezar-extension-api'

import type { ExtensionScope } from '../extensions/registry'

/**
 * The cockpit's event bus (spec `.ai/specs/2026-09-19-extension-event-api.md`): one per page,
 * shared by core and every extension activation.
 *
 * PURE on purpose, like `commands/registry.ts`: the extension API is its only runtime import — no
 * React, no DOM, no module-level state — so it runs unchanged under vitest and outside React. Core
 * uses it directly: it emits only `cezar.*` ids and may subscribe to anything. Each extension
 * activation gets `forExtension(scope)` — the `Events` it sees as `context.events` — where every
 * subscription goes through `scope.track()`, so deactivation removes them all.
 *
 * § Delivery, precisely: `emit` checks the id, snapshots the payload as JSON and the live
 * subscriptions, queues one delivery per subscription and returns. The queue drains in a
 * microtask, in emit order; each listener gets its own `JSON.parse` of the snapshot, and a throw
 * or a rejection is reported and isolated. Two guards bound a storm: a cascade depth for emits
 * made synchronously inside a listener, and a per-macrotask delivery budget that yields to
 * rendering.
 */

export interface EventBus {
  /** Core emit: `cezar.*` ids only. Throws `invalid-id`, `namespace-violation`, `invalid-input`. */
  emit<P>(event: EventToken<P>, ...payload: [P] extends [void] ? [] : [payload: P]): void
  /** Core subscription (tests, future core consumers). Throws `invalid-id`, `invalid-input`. */
  on<P>(event: EventToken<P>, listener: (payload: P) => void): Disposable
  /**
   * The `Events` one extension activation sees as `context.events`. Every method first calls
   * `scope.assertLive()` (so it throws `disposed` after deactivation); `emit` accepts only ids
   * under `${extension.id}.` and never a `cezar.*` one; `on` and `once` go through
   * `scope.track()`; `off` reaches only this view's own subscriptions.
   */
  forExtension(scope: ExtensionScope): Events
}

export interface EventBusOptions {
  /** Every listener failure, dropped cascade and deferred backlog. Default: {@link logEventError}. Called inside try/catch. */
  readonly onError?: (report: EventErrorReport) => void
  /** Deepest chain of emits made from inside listeners before an emit is dropped. Default 16. */
  readonly maxCascadeDepth?: number
  /**
   * Listener calls allowed before the queue yields to the next macrotask. Default 1_000. Counted
   * from the first delivery after the bus's own last yield, so an unrelated task in between does
   * not reset the count: the bus may yield a little early, never late.
   */
  readonly deliveryBudget?: number
}

export interface EventErrorReport {
  /** The listener's (or, for `cascade`, the emitter's) extension; `undefined` for core. */
  readonly extensionId: ExtensionId | undefined
  readonly eventId: ContributionId
  /**
   * `listener`: a listener threw or rejected; `error` is what it threw. `cascade`: an emit made
   * inside a listener went deeper than `maxCascadeDepth` and was dropped — reported once per event
   * id per streak, however many emits a fan-out drops. `backlog`: the queue spent its delivery
   * budget and yields until the next macrotask — reported once per streak, for the delivery that
   * waits. A streak ends at the first macrotask the bus reaches without having had to yield.
   */
  readonly kind: 'listener' | 'cascade' | 'backlog'
  readonly error: unknown
}

/** Recognised by `isExtensionError` (duck-typed on `code`). */
export class EventError extends Error {
  override readonly name = 'EventError' as const
  readonly code: ExtensionErrorCode
  /** The id that was addressed, when there was a well-formed one. */
  readonly eventId?: ContributionId

  constructor(code: ExtensionErrorCode, message: string, options: { readonly eventId?: ContributionId } = {}) {
    super(message)
    this.code = code
    if (options.eventId !== undefined) this.eventId = options.eventId
  }
}

/** The default `onError`: one console line per report. */
export function logEventError(report: EventErrorReport): void {
  const who = report.extensionId ?? 'core'
  const what =
    report.kind === 'listener'
      ? `listener for ${report.eventId} failed`
      : report.kind === 'cascade'
        ? `emit of ${report.eventId} dropped`
        : `delivery of ${report.eventId} deferred`
  console.error(`[cezar:extensions] ${who}: ${what}`, report.error)
}

const CORE_PREFIX = 'cezar.'
const DEFAULT_MAX_CASCADE_DEPTH = 16
const DEFAULT_DELIVERY_BUDGET = 1_000
const INVALID_TOKEN = 'Invalid event: expected { kind: "event", id } with a valid contribution id'

type Listener = (payload: unknown) => unknown

/** One `on` or `once`. Compared by identity; `live` turns false for good when it is disposed or delivered (`once`). */
interface Subscription {
  readonly id: ContributionId
  readonly listener: Listener
  readonly once: boolean
  /** The subscribing extension; `undefined` for core. */
  readonly extensionId: ExtensionId | undefined
  live: boolean
  /** An extension subscription's tracked handle: disposing it untracks it from the scope. */
  handle: Disposable | undefined
}

/** One listener call waiting in the queue. */
interface Delivery {
  readonly subscription: Subscription
  readonly eventId: ContributionId
  /** The payload's JSON snapshot; `undefined` delivers `undefined` without a parse. */
  readonly snapshot: string | undefined
  readonly depth: number
}

export function createEventBus(options: EventBusOptions = {}): EventBus {
  const onError = options.onError ?? logEventError
  const maxCascadeDepth = resolveCount(options.maxCascadeDepth, DEFAULT_MAX_CASCADE_DEPTH, 0)
  const deliveryBudget = resolveCount(options.deliveryBudget, DEFAULT_DELIVERY_BUDGET, 1)

  /** Live subscriptions by event id; a Set keeps subscription order. */
  const subscribers = new Map<ContributionId, Set<Subscription>>()
  const queue: Delivery[] = []
  let head = 0

  /** The depth of the delivery whose listener is running synchronously right now. */
  let runningDepth: number | undefined
  /** Listener calls since the bus's own last yield. */
  let calls = 0
  let drainScheduled = false
  let draining = false
  /** Draining waits for the next macrotask: the delivery budget is spent. */
  let paused = false
  /** The current streak of pauses has been reported. */
  let backlogReported = false
  /** Event ids whose dropped cascade has been reported in the current streak. */
  const cascadesReported = new Set<ContributionId>()
  const macrotask = createMacrotaskScheduler(() => {
    calls = 0
    if (paused) {
      paused = false
      drain()
      // A resumed drain that found only cancelled deliveries ran no listener, so it scheduled no
      // tick of its own — and without one the streak would never end.
      if (!paused) macrotask.schedule()
    } else {
      // A whole macrotask period without a pause: the storm, if there was one, is over. (Not an
      // empty queue: an async ping-pong empties it after every delivery.)
      backlogReported = false
      cascadesReported.clear()
    }
  })

  const report = (error: Omit<EventErrorReport, 'error'>, cause: unknown): void => {
    try {
      onError({ ...error, error: cause })
    } catch {
      // A throwing reporter must not break delivery or the emitter.
    }
  }

  const unsubscribe = (subscription: Subscription): void => {
    subscription.live = false
    const set = subscribers.get(subscription.id)
    if (set === undefined) return
    set.delete(subscription)
    if (set.size === 0) subscribers.delete(subscription.id)
  }

  const subscribe = (subscription: Subscription): void => {
    const set = subscribers.get(subscription.id)
    if (set === undefined) subscribers.set(subscription.id, new Set([subscription]))
    else set.add(subscription)
  }

  const scheduleDrain = (): void => {
    if (drainScheduled || draining || paused) return
    drainScheduled = true
    queueMicrotask(drain)
  }

  const deliver = ({ subscription, snapshot, depth }: Delivery): void => {
    if (subscription.once) {
      // Emit already took it off the event's list; this ends it for good and untracks it from its
      // scope (through the handle, which also drops it from its view's own index).
      subscription.live = false
      subscription.handle?.dispose()
    }
    runningDepth = depth
    try {
      const result = subscription.listener(snapshot === undefined ? undefined : JSON.parse(snapshot))
      if (isObjectLike(result)) {
        // A returned promise's rejection is a failure too. `Promise.resolve` reads `then` itself,
        // so a thenable with a throwing getter rejects here instead of throwing.
        Promise.resolve(result).catch((error: unknown) =>
          report({ extensionId: subscription.extensionId, eventId: subscription.id, kind: 'listener' }, error),
        )
      }
    } catch (error) {
      report({ extensionId: subscription.extensionId, eventId: subscription.id, kind: 'listener' }, error)
    } finally {
      runningDepth = undefined
    }
  }

  function drain(): void {
    drainScheduled = false
    if (paused || draining) return
    draining = true
    try {
      while (head < queue.length) {
        const next = queue[head] as Delivery
        if (!next.subscription.live) {
          // Cancelled since the emit: skipped, and not counted against the budget.
          head += 1
          continue
        }
        if (calls >= deliveryBudget) {
          paused = true
          if (!backlogReported) {
            backlogReported = true
            report(
              { extensionId: next.subscription.extensionId, eventId: next.eventId, kind: 'backlog' },
              new Error(`Event delivery yielded after ${deliveryBudget} listener calls without a macrotask`),
            )
          }
          macrotask.schedule()
          return
        }
        head += 1
        calls += 1
        macrotask.schedule()
        deliver(next)
      }
      queue.length = 0
      head = 0
    } finally {
      draining = false
      if (head > 0 && head >= queue.length / 2) {
        queue.splice(0, head)
        head = 0
      }
    }
  }

  /** § Delivery, precisely, steps 2 and 4–7: `owns` is step 3, checked by the view. */
  const emit = (
    token: unknown,
    payload: readonly unknown[],
    emitter: ExtensionId | undefined,
    owns: (id: ContributionId) => string | undefined,
  ): void => {
    const id = tokenId(token)
    if (id === undefined) throw new EventError('invalid-id', INVALID_TOKEN)
    const violation = owns(id)
    if (violation !== undefined) throw new EventError('namespace-violation', violation, { eventId: id })

    let snapshot: string | undefined
    try {
      snapshot = JSON.stringify(payload[0])
    } catch {
      // Named by the event, never by the value: payloads may carry user content.
      throw new EventError('invalid-input', `The payload of event "${id}" is not JSON`, { eventId: id })
    }

    const depth = runningDepth === undefined ? 0 : runningDepth + 1
    if (depth > maxCascadeDepth) {
      // Once per event id per streak: a 2× fan-out drops 2^17 emits at the default depth, and one
      // report says everything the other 131,071 would.
      if (!cascadesReported.has(id)) {
        cascadesReported.add(id)
        report(
          { extensionId: emitter, eventId: id, kind: 'cascade' },
          new Error(`Emit of "${id}" dropped: more than ${maxCascadeDepth} emits chained from inside listeners`),
        )
      }
      return
    }

    const set = subscribers.get(id)
    if (set === undefined) return
    for (const subscription of [...set]) {
      // A `once` leaves the list now, so a second emit cannot reach it; until it is delivered,
      // `off`, its Disposable or its extension's deactivation can still cancel it (`live`).
      if (subscription.once) set.delete(subscription)
      queue.push({ subscription, eventId: id, snapshot, depth })
    }
    if (set.size === 0) subscribers.delete(id)
    scheduleDrain()
  }

  /** Validates and builds a subscription; step 2 and 3 of `on`/`once`. */
  const createSubscription = (
    token: unknown,
    listener: unknown,
    once: boolean,
    extensionId: ExtensionId | undefined,
  ): Subscription => {
    const id = tokenId(token)
    if (id === undefined) throw new EventError('invalid-id', INVALID_TOKEN)
    if (typeof listener !== 'function') {
      throw new EventError('invalid-input', `The listener for event "${id}" is not a function`, { eventId: id })
    }
    return { id, listener: listener as Listener, once, extensionId, live: true, handle: undefined }
  }

  return {
    emit(event, ...payload) {
      emit(event, payload, undefined, (id) =>
        id.startsWith(CORE_PREFIX) ? undefined : `Core event "${id}" must be under "${CORE_PREFIX}"`,
      )
    },

    on(event, listener) {
      const subscription = createSubscription(event, listener, false, undefined)
      subscribe(subscription)
      let disposed = false
      return {
        dispose() {
          if (disposed) return
          disposed = true
          unsubscribe(subscription)
        },
      }
    },

    forExtension(scope) {
      const extensionId = scope.extension.id
      const prefix = `${extensionId}.`
      /** This view's subscriptions by id — pending `once`s included, which the bus's list no longer holds. */
      const own = new Map<ContributionId, Set<Subscription>>()

      const listen = (event: unknown, listener: unknown, once: boolean): Disposable => {
        scope.assertLive()
        const subscription = createSubscription(event, listener, once, extensionId)
        const registration: Disposable = {
          dispose() {
            unsubscribe(subscription)
            const mine = own.get(subscription.id)
            if (mine === undefined) return
            mine.delete(subscription)
            if (mine.size === 0) own.delete(subscription.id)
          },
        }
        // On an ended activation `track` disposes the registration and throws `disposed`; nothing
        // was added yet, so nothing leaks.
        const handle = scope.track(registration)
        subscription.handle = handle
        subscribe(subscription)
        const mine = own.get(subscription.id)
        if (mine === undefined) own.set(subscription.id, new Set([subscription]))
        else mine.add(subscription)
        return handle
      }

      return Object.freeze<Events>({
        on(event, listener) {
          return listen(event, listener, false)
        },

        once(event, listener) {
          return listen(event, listener, true)
        },

        off(event, listener) {
          scope.assertLive()
          const id = tokenId(event)
          if (id === undefined) throw new EventError('invalid-id', INVALID_TOKEN)
          for (const subscription of [...(own.get(id) ?? [])]) {
            if (subscription.listener === listener) subscription.handle?.dispose()
          }
        },

        emit(event, ...payload) {
          scope.assertLive()
          emit(event, payload, extensionId, (id) => {
            // Core ids first, whatever the extension's own id: a built-in under the `cezar`
            // publisher emits core events only through core code, so they cannot be spoofed.
            if (id.startsWith(CORE_PREFIX)) {
              return `Extension "${extensionId}" may not emit core event "${id}"`
            }
            return id.startsWith(prefix)
              ? undefined
              : `Extension "${extensionId}" may only emit events under "${prefix}", not "${id}"`
          })
        },
      })
    },
  }
}

/**
 * Runs `callback` in the next macrotask, once per `schedule` streak. The same order React's
 * scheduler uses: `setImmediate` where it exists (Node, so vitest), because Node handles a whole
 * batch of `MessageChannel` messages in one loop turn and would starve its timers; else a
 * `MessageChannel` post (browsers), which is not clamped like a nested `setTimeout`; else
 * `setTimeout(0)`.
 */
function createMacrotaskScheduler(callback: () => void): { schedule(): void } {
  let scheduled = false
  const run = (): void => {
    scheduled = false
    callback()
  }
  const { setImmediate } = globalThis as { setImmediate?: (run: () => void) => unknown }
  let post: () => void
  if (typeof setImmediate === 'function') {
    post = () => void setImmediate(run)
  } else if (typeof MessageChannel === 'function') {
    const channel = new MessageChannel()
    channel.port1.onmessage = run
    post = () => channel.port2.postMessage(null)
  } else {
    post = () => void setTimeout(run, 0)
  }
  return {
    schedule() {
      if (scheduled) return
      scheduled = true
      post()
    },
  }
}

/** The id of a well-formed event token, or `undefined` — never throws, whatever it is given. */
function tokenId(event: unknown): ContributionId | undefined {
  try {
    if (typeof event !== 'object' || event === null) return undefined
    const { kind, id } = event as { kind?: unknown; id?: unknown }
    return kind === 'event' && typeof id === 'string' && isValidContributionId(id) ? id : undefined
  } catch {
    // A throwing getter or a Proxy trap: not a token.
    return undefined
  }
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

/** `value` as a whole number: floored, and raised to `min` when below it. `fallback` when it is not a number (or NaN). */
function resolveCount(value: number | undefined, fallback: number, min: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.max(Math.floor(value), min)
}
