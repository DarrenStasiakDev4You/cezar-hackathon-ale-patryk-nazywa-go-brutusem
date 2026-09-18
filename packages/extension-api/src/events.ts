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
 * The in-browser event bus. Host semantics:
 * - Delivery is asynchronous (after `emit` returns), in subscription order.
 * - A throwing listener is isolated and reported — never propagated to the emitter or to the
 *   other listeners.
 * - An extension emits only events in its own namespace; `cezar.*` events are emitted by core
 *   only. Any extension may listen to any event.
 */
export interface Events {
  on<P>(event: EventToken<P>, listener: (payload: P) => void): Disposable
  /** Payload-less events are emitted as `emit(token)`. */
  emit<P>(event: EventToken<P>, ...payload: [P] extends [void] ? [] : [payload: P]): void
}
