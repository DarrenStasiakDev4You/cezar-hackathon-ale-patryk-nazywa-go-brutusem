import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react'

import type { ContributionId } from '@open-mercato/cezar-extension-api'

import { toast } from '@/components/ui/toaster'

import { createCoreComponentRegistry } from './core-components'
import type { CockpitComponentRegistry, ComponentRegistration } from './registry'

/**
 * React bindings for the component registry (spec `.ai/specs/2026-09-19-component-host.md`):
 * `ComponentsProvider` hands every `ComponentHost` the page's registry, the user's choice per
 * contract and the record of the implementations that threw in this page load. It follows
 * `CommandsProvider`: `main.tsx` passes the registry the extension host shares, and a test that
 * omits it gets one of its own.
 */

/** One implementation that threw, as the reporter receives it. */
export interface ImplementationFailure {
  /** `ComponentRegistration`, not `UsableComponent<unknown>`: a component typed with its
   *  contract's props does not fit a wider props type. */
  readonly registration: ComponentRegistration
  /** Core's default, which now renders in its place. */
  readonly fallback: ComponentRegistration
  readonly error: unknown
}

/** What a `ComponentHost` reads from the provider. Internal: pages use `ComponentHost`. */
export interface ComponentsRuntime {
  readonly registry: CockpitComponentRegistry
  /** The implementation the user chose for a contract, or `null`. */
  readonly preferenceOf: (contractId: ContributionId) => ContributionId | null
  /** Whether `registration` threw for `subject` in this page load. A new function whenever the
   *  record grows, so every host that reads it re-renders. */
  readonly hasFailed: (registration: ComponentRegistration, subject: string) => boolean
  /** Records an extension's implementation as failed for `subject`, and reports its first
   *  failure. Called from `componentDidCatch` only; a repeat for the same pair is ignored. */
  readonly recordFailure: (failure: ImplementationFailure, subject: string) => void
  /** The declared default threw: one `console.error` line, no toast. */
  readonly reportDefaultFailure: (registration: ComponentRegistration, error: unknown) => void
  /** No declared default for `contractId`: one `console.error` line per contract per provider. */
  readonly reportUnresolved: (contractId: ContributionId) => void
}

const ComponentsContext = createContext<ComponentsRuntime | null>(null)

/** No choice for any contract (spec Q5): core's default renders everywhere. */
const NO_PREFERENCE = (): ContributionId | null => null

/**
 * The default `onImplementationError` (spec Q6): one toast naming the implementation, and one
 * `[cezar:extensions]` console line with the error.
 */
export function reportImplementationFailure(failure: ImplementationFailure): void {
  const { registration, fallback, error } = failure
  console.error(
    `[cezar:extensions] ${registration.componentId} (${registration.extensionId ?? 'core'}) failed while rendering; showing ${fallback.componentId} instead`,
    error,
  )
  toast(`${registration.metadata.title} stopped working. Showing Cezar’s default ${sentenceCase(fallback.metadata.title)}.`)
}

/**
 * Hands the component registry to the tree.
 *
 * `registry` is the page's own (`main.tsx` builds it, so the extension host shares it); it is read
 * once, at mount. Omitted (tests): a registry of its own from `createCoreComponentRegistry`, so a
 * test renders the header exactly as the page does.
 */
export function ComponentsProvider(props: {
  /** `main.tsx`'s registry, shared with the extension host. Omitted (tests): a registry of its
   *  own from `createCoreComponentRegistry`, as `main.tsx` builds the page's. Read once. */
  readonly registry?: CockpitComponentRegistry
  /** The implementation the user chose for a contract. Omitted: no choice for any contract (Q5).
   *  Hosts re-resolve when this function's identity changes. */
  readonly preferenceOf?: (contractId: ContributionId) => ContributionId | null
  /** Called once per failed registration per provider. Default: one toast and one
   *  `[cezar:extensions]` `console.error` line (Q6). */
  readonly onImplementationError?: (failure: ImplementationFailure) => void
  readonly children: ReactNode
}): ReactElement {
  const [registry] = useState(() => props.registry ?? createCoreComponentRegistry())
  // Keyed by the registration object, so a disposed registration drops out and a re-provided one
  // (a new object) is tried again. Mutated only from `componentDidCatch` and effects.
  const [failures] = useState(() => new WeakMap<ComponentRegistration, Set<string>>())
  const [reported] = useState(() => new WeakSet<ComponentRegistration>())
  const [unresolved] = useState(() => new Set<ContributionId>())
  const [failureRevision, setFailureRevision] = useState(0)

  const preferenceOf = props.preferenceOf ?? NO_PREFERENCE
  const onImplementationError = props.onImplementationError ?? reportImplementationFailure

  const recordFailure = useCallback(
    (failure: ImplementationFailure, subject: string) => {
      let subjects = failures.get(failure.registration)
      if (subjects === undefined) {
        subjects = new Set()
        failures.set(failure.registration, subjects)
      }
      // StrictMode, and two hosts of one subject, catch the same failure twice: one record.
      if (subjects.has(subject)) return
      subjects.add(subject)
      setFailureRevision((revision) => revision + 1)
      if (reported.has(failure.registration)) return
      reported.add(failure.registration)
      try {
        onImplementationError(failure)
      } catch {
        // A throwing reporter must not break the host that is showing core's default.
      }
    },
    [failures, reported, onImplementationError],
  )

  const reportDefaultFailure = useCallback((registration: ComponentRegistration, error: unknown) => {
    console.error(`[cezar:extensions] default implementation ${registration.componentId} failed while rendering`, error)
  }, [])

  const reportUnresolved = useCallback(
    (contractId: ContributionId) => {
      if (unresolved.has(contractId)) return
      unresolved.add(contractId)
      console.error(`[cezar:extensions] ${contractId} has no default implementation: nothing renders in its host`)
    },
    [unresolved],
  )

  const runtime = useMemo<ComponentsRuntime>(
    () => ({
      registry,
      preferenceOf,
      hasFailed: (registration, subject) => failures.get(registration)?.has(subject) === true,
      recordFailure,
      reportDefaultFailure,
      reportUnresolved,
    }),
    // `failureRevision` renews `hasFailed`, and so the context, whenever the record grows.
    [registry, preferenceOf, failureRevision, failures, recordFailure, reportDefaultFailure, reportUnresolved],
  )

  return <ComponentsContext.Provider value={runtime}>{props.children}</ComponentsContext.Provider>
}

/** The registry the pages render from. Throws outside `ComponentsProvider`, like `useCommands`. */
export function useComponentRegistry(): CockpitComponentRegistry {
  return useComponentsRuntime().registry
}

/** Everything `ComponentHost` reads. Throws outside `ComponentsProvider`. */
export function useComponentsRuntime(): ComponentsRuntime {
  const runtime = useContext(ComponentsContext)
  if (runtime === null) throw new Error('ComponentHost and useComponentRegistry must be used inside <ComponentsProvider>')
  return runtime
}

/** `Task header` → `task header`; an acronym such as `PR list` keeps its case. */
function sentenceCase(title: string): string {
  const [first = '', second = ''] = title
  return second !== '' && second === second.toUpperCase() && second !== second.toLowerCase()
    ? title
    : first.toLowerCase() + title.slice(1)
}
