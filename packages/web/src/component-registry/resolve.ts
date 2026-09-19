import { isValidContributionId, type ComponentContract, type ContributionId } from '@open-mercato/cezar-extension-api'

import type {
  AnyComponentContract,
  CockpitComponentRegistry,
  ComponentRegistration,
  ComponentRegistrationIssue,
  UsableComponent,
} from './registry'

/**
 * The component resolver (spec `.ai/specs/2026-09-19-component-resolver.md`): which implementation
 * of a contract renders. The user's preferred implementation when it is usable, otherwise core's
 * default, which the result always carries as the fallback. Providing an implementation never
 * selects it.
 *
 * PURE on purpose, like `registry.ts`: `isValidContributionId` is its only runtime import. No DOM,
 * no module state, no cache and no logging. It reads the registry through `listUsable` and `get`
 * only, so its result depends on the registry's contents, the token and the preference alone,
 * never on the order extensions registered in. Nothing renders the result yet: the slot, the
 * stored preference and the picker are later items.
 */

/** The reads the resolver needs. The cockpit's registry is one. */
export type ResolverRegistry = Pick<CockpitComponentRegistry, 'listUsable' | 'get'>

/** The id of core's default implementation of a contract:
 *  `cezar.task.header` → `cezar.task.header.default`. */
export function coreDefaultComponentId(contractId: ContributionId): ContributionId {
  return `${contractId}.default`
}

/** Why a preference was set aside. `invalid` never echoes the value it was given. */
export type PreferenceRejection =
  | { readonly reason: 'invalid' }
  | { readonly reason: 'not-found'; readonly componentId: ContributionId }
  | { readonly reason: 'other-contract'; readonly componentId: ContributionId; readonly contractId: ContributionId }
  | {
      readonly reason: 'incompatible'
      readonly componentId: ContributionId
      /** The registration's own issues, by reference: never empty. */
      readonly issues: readonly ComponentRegistrationIssue[]
    }

interface Resolved<P> {
  readonly status: 'resolved'
  /** What to render: the preferred implementation when it is a candidate, otherwise `fallback`. */
  readonly component: UsableComponent<P>
  /** Core's default for this contract. It is always present, and it is what to render when
   *  `component` fails while rendering. It is the same object as `component` when `source` is
   *  `'default'`. */
  readonly fallback: UsableComponent<P>
}

/** `'preference'`: the user's choice renders. `'default'`: there was no preference, or it was set
 *  aside, and then `rejected` says why. Callers narrow on `source`. */
export type ResolvedComponent<P> =
  | (Resolved<P> & { readonly source: 'preference' })
  | (Resolved<P> & { readonly source: 'default'; readonly rejected?: PreferenceRejection })

/** No usable core default for this token: the cockpit does not serve it at this major, or core
 *  registered no default for it. A core bug, which `missingCoreDefaults` reports. */
export interface UnresolvedComponent {
  readonly status: 'unresolved'
}

export type ComponentResolution<P> = ResolvedComponent<P> | UnresolvedComponent

/**
 * § Resolving, precisely: the steps run in order, and the first one that returns ends the call.
 * Frozen result, new on every call. Never throws for any contract or preference, given a registry
 * whose `listUsable` and `get` never throw (the cockpit's never do).
 */
export function resolveComponent<P>(
  registry: ResolverRegistry,
  contract: ComponentContract<P>,
  /** The component id the user chose for this contract. `undefined` and `null`: no choice. */
  preference?: ContributionId | null,
): ComponentResolution<P> {
  // 1. `[]` for a malformed token and for one the cockpit does not serve at this major.
  const candidates = registry.listUsable(contract)

  // 2. Core's default, found by its id so that registration order cannot pick it. The id comes
  //    from the candidate, so the token is not read a second time.
  const fallback = candidates.find(
    (candidate) => candidate.extensionId === null && candidate.componentId === coreDefaultComponentId(candidate.contractId),
  )
  if (fallback === undefined) {
    const unresolved: UnresolvedComponent = { status: 'unresolved' }
    return Object.freeze(unresolved)
  }

  // 3. No choice.
  if (preference === undefined || preference === null) {
    const resolved: ResolvedComponent<P> = { status: 'resolved', component: fallback, fallback, source: 'default' }
    return Object.freeze(resolved)
  }

  // 4. A typeof check and a regular expression: nothing here can throw, whatever `preference` is.
  if (typeof preference !== 'string' || !isValidContributionId(preference)) {
    return setAside(fallback, { reason: 'invalid' })
  }

  // 5. A candidate, core's own implementations included.
  const chosen = candidates.find((candidate) => candidate.componentId === preference)
  if (chosen !== undefined) {
    const resolved: ResolvedComponent<P> = { status: 'resolved', component: chosen, fallback, source: 'preference' }
    return Object.freeze(resolved)
  }

  // 6 and 7. Why not, then core's default.
  return setAside(fallback, whyNot(registry.get(preference), preference, fallback.contractId))
}

/**
 * The ids of the served contracts that have no core default: each contract in `contracts` that
 * `resolveComponent(registry, contract)` leaves `unresolved`, in catalog order. `[]` when every
 * one resolves. The slot item's gate test asserts `[]` for `CORE_COMPONENT_CONTRACTS`.
 */
export function missingCoreDefaults(
  registry: ResolverRegistry,
  contracts: readonly AnyComponentContract[],
): readonly ContributionId[] {
  const missing: ContributionId[] = []
  for (const contract of contracts) {
    if (resolveComponent(registry, contract).status === 'unresolved') missing.push(contract.id)
  }
  return Object.freeze(missing)
}

/** Step 7: core's default renders, and `rejected` says why the preference did not. */
function setAside<P>(fallback: UsableComponent<P>, rejected: PreferenceRejection): ResolvedComponent<P> {
  const resolved: ResolvedComponent<P> = {
    status: 'resolved',
    component: fallback,
    fallback,
    source: 'default',
    rejected: Object.freeze(rejected),
  }
  return Object.freeze(resolved)
}

/** Step 6: why a well-formed preference that is not a candidate cannot render. */
function whyNot(
  registration: ComponentRegistration | undefined,
  componentId: ContributionId,
  contractId: ContributionId,
): PreferenceRejection {
  if (registration === undefined) return { reason: 'not-found', componentId }
  if (registration.contractId !== contractId) {
    return { reason: 'other-contract', componentId, contractId: registration.contractId }
  }
  // The registry sets `compatible` exactly when `issues` is empty, so these issues are never empty.
  if (!registration.compatible) return { reason: 'incompatible', componentId, issues: registration.issues }
  // A compatible registration of this contract is a candidate in the cockpit's registry. Only a
  // fake registry gets here, and a preference that did not render is not a misfit.
  return { reason: 'not-found', componentId }
}
