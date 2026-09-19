import { createContext, useContext, useState, type ReactNode } from 'react'

import { createEventBus, type EventBus } from './bus'

/**
 * React bindings for the event bus (spec `.ai/specs/2026-09-19-extension-event-api.md`, § React
 * bindings). Core event sources inside the tree — the stream relay in `useGlobalEvents`, the
 * `ProjectChangeReporter` — reach the page's bus through `useEventBus()`.
 */

const EventBusContext = createContext<EventBus | null>(null)

/**
 * Hands the bus to the tree. `bus` is the page's own (`main.tsx` builds it, so the extension host
 * shares it); it is read once, at mount. Omitted (tests) → one bus per provider. StrictMode's
 * double-invoke of the initializer is harmless: a bus has no side effects outside the object.
 */
export function EventBusProvider(props: { readonly bus?: EventBus; readonly children: ReactNode }) {
  const [bus] = useState(() => props.bus ?? createEventBus())
  return <EventBusContext.Provider value={bus}>{props.children}</EventBusContext.Provider>
}

/**
 * The page's bus, or `null` outside `EventBusProvider` — never a throw. Every core event source
 * is optional, so a test (or a subtree) rendered without the provider keeps its behaviour and
 * simply emits nothing.
 */
export function useEventBus(): EventBus | null {
  return useContext(EventBusContext)
}
