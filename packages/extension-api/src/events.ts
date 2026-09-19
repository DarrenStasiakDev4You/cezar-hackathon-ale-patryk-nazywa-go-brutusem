import type { ContributionId } from './ids.ts'
import type { IsJson } from './json.ts'
import type { Disposable } from './lifecycle.ts'
import { createToken } from './tokens.ts'

/** A typed handle on an event id, shared by emitters and listeners. Created with {@link defineEvent}. */
export interface EventToken<Payload = void> {
  readonly kind: 'event'
  readonly id: ContributionId
  /** Type-only phantom, as on `CommandToken`. */
  readonly __payload?: (payload: Payload) => Payload
}

/**
 * Declares an event: `defineEvent<{ name: string }>('acme.hello.greeted')`. `void` (the default)
 * means the event carries no payload.
 *
 * The payload must be JSON (see {@link IsJson}) — otherwise the id parameter is `never`, a compile
 * error here. Throws {@link ExtensionDefinitionError} (code `invalid-id`) when the id is not a
 * {@link ContributionId}. Returns a frozen `{ kind, id }`.
 */
export function defineEvent<Payload = void>(
  id: IsJson<Payload> extends true ? ContributionId : never,
): EventToken<Payload> {
  return createToken<EventToken<Payload>>({ kind: 'event', id })
}

/**
 * The in-browser event bus, as one extension sees it. Host semantics:
 *
 * - **Asynchronous, in order.** `emit` returns before any listener runs. Emits are delivered in
 *   emit order and, within one emit, in subscription order. A listener receives only events
 *   emitted after it subscribed.
 * - **A snapshot per listener.** The payload is copied as JSON when it is emitted, and every
 *   listener gets its own copy: a mutation by the emitter or by another listener is never seen.
 *   A payload that is not JSON (a cycle, a `bigint`) makes `emit` throw `invalid-input`.
 * - **Isolated listeners.** A listener that throws, or returns a promise that rejects, is reported
 *   by the host and never reaches the emitter or the other listeners; its extension stays active.
 * - **Owned namespaces.** An extension emits only ids under its own `${extension.id}.` prefix, and
 *   never a core (`cezar.*`) id — `namespace-violation` otherwise. Any extension may listen to any
 *   id, so never put a secret in a payload.
 * - **Bounded.** An emit made synchronously from inside a listener counts toward a cascade depth
 *   limit (16 in the cockpit); past it, the emit is dropped and reported. The host also yields to
 *   rendering between long runs of deliveries.
 * - **Cleanup.** Every subscription is disposed when the extension deactivates, including
 *   deliveries already queued for it. From then on every method throws `disposed`.
 *
 * A malformed token (not `{ kind: 'event', id: <valid ContributionId> }`) throws `invalid-id`,
 * and a listener that is not a function throws `invalid-input`. Subscribing to an id nobody emits
 * is allowed and inert, so an extension written for a newer Cezar still activates on an older one.
 */
export interface Events {
  /** Calls `listener` for every later emit of `event`. The Disposable removes this one subscription. */
  on<P>(event: EventToken<P>, listener: (payload: P) => void): Disposable
  /** Like `on`, for the first later emit only; detached before that emit is delivered. */
  once<P>(event: EventToken<P>, listener: (payload: P) => void): Disposable
  /**
   * Removes every subscription of `listener` to `event` made through this context — `once`
   * included, even one whose emit is queued but not yet delivered. Matches `listener` by identity:
   * a re-created arrow function is another listener. No-op when there is none.
   */
  off<P>(event: EventToken<P>, listener: (payload: P) => void): void
  /** Payload-less events are emitted as `emit(token)`. */
  emit<P>(event: EventToken<P>, ...payload: [P] extends [void] ? [] : [payload: P]): void
}
