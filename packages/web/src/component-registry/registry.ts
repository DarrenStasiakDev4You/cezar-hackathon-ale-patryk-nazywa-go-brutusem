import {
  isValidContributionId,
  type ComponentCapability,
  type ComponentCompatibilityIssue,
  type ComponentContract,
  type ContributionId,
  type ExtensionErrorCode,
  type ExtensionId,
} from '@open-mercato/cezar-extension-api'
import type { ComponentType } from 'react'

/**
 * The cockpit's component registry (spec `.ai/specs/2026-09-19-component-registry.md`): every
 * implementation of a component contract, from core and from extensions, as one registration
 * with its provenance and its fit.
 *
 * PURE on purpose, like `commands/registry.ts` and `events/bus.ts`: the extension API is its only
 * runtime import (React through `import type` only). No DOM, no module-level state, so it runs
 * unchanged under vitest and outside React. `options.contracts` is the host's own catalog: every
 * implementation is checked against the host's token for its contract id, never against the token
 * the implementation brought along.
 */

/** Shown to the user when they choose an implementation. */
export interface ComponentMetadata {
  /** Non-empty. */
  readonly title: string
  /** Present only when the implementation gave one. */
  readonly description?: string
}

/** The check's issues, plus the one only the host can know. */
export type ComponentRegistrationIssue =
  | ComponentCompatibilityIssue
  | { readonly code: 'unknown-contract'; readonly message: string; readonly contractId: ContributionId }

/** One implementation of a contract, as the registry holds it. Deeply frozen; never mutated. */
export interface ComponentRegistration {
  /** The implementation's id: `cezar.…` for core, `${extensionId}.…` for an extension. Unique
   *  across the registry. */
  readonly componentId: ContributionId
  /** The extension that provided it, taken from the activation scope. `null`: core's own. */
  readonly extensionId: ExtensionId | null
  /** The contract the implementation was compiled against: the id and major of the token passed
   *  to `provide`/`register`, which may differ from the major the host serves. */
  readonly contractId: ContributionId
  readonly contractVersion: number
  /** Kept by reference, never called by the registry. Typed so that no props fit it: only
   *  `listUsable` hands out a component typed with its contract's props. */
  readonly component: ComponentType<never>
  /** The capabilities the implementation declared, de-duplicated, in its own order. */
  readonly declaredCapabilities: readonly ComponentCapability[]
  /** What the host may rely on: the check's `capabilities` (every required one, then the declared
   *  optional ones, in contract order). `[]` when not compatible. */
  readonly capabilities: readonly ComponentCapability[]
  readonly metadata: ComponentMetadata
  /** `true` exactly when `issues` is empty. Only a compatible registration may be rendered. */
  readonly compatible: boolean
  readonly issues: readonly ComponentRegistrationIssue[]
}

/** A compatible registration of the served contract, as `listUsable` returns it. */
export interface UsableComponent<Props> extends Omit<ComponentRegistration, 'component' | 'compatible' | 'issues'> {
  readonly component: ComponentType<Props>
  readonly compatible: true
  readonly issues: readonly []
}

/**
 * A contract token of any props, as the catalog holds it. `ComponentContract<unknown>` would not
 * do: its props phantom is invariant, so a typed token would not fit without a cast.
 */
export type AnyComponentContract = Omit<ComponentContract<unknown>, '__props'>

export interface ComponentRegistryOptions {
  /** The contracts this cockpit serves: the host's own tokens, one major per id, `cezar.*` ids
   *  only. Default `[]`. */
  readonly contracts?: readonly AnyComponentContract[]
  /** Called once for each registration recorded with `compatible: false`. Default:
   *  {@link logComponentDiagnostic}. Called inside a try/catch: a throwing reporter is swallowed. */
  readonly onDiagnostic?: (registration: ComponentRegistration) => void
}

/** The cockpit's view of the registry. Members arrive with the steps that build them. */
export interface CockpitComponentRegistry {}

/** Recognised by `isExtensionError` (duck-typed on `code`), like `CommandError` and `EventError`. */
export class ComponentError extends Error {
  override readonly name = 'ComponentError' as const
  readonly code: ExtensionErrorCode
  /** The component id that was addressed, when there was a well-formed one. */
  readonly componentId?: ContributionId

  constructor(code: ExtensionErrorCode, message: string, options: { readonly componentId?: ContributionId } = {}) {
    super(message)
    this.code = code
    if (options.componentId !== undefined) this.componentId = options.componentId
  }
}

/** The default `onDiagnostic`: one console line per registration the host will not use. */
export function logComponentDiagnostic(registration: ComponentRegistration): void {
  const who = registration.extensionId ?? 'core'
  const why = registration.issues.map((issue) => issue.message).join('; ')
  console.warn(`[cezar:extensions] ${registration.componentId} (${who}) is not used: ${why}`)
}

const CORE_PREFIX = 'cezar.'
const INVALID_CONTRACT =
  'Invalid component contract: expected { kind: "component", id, version } with a valid contribution id and a positive integer version'

/** The host's catalog entry for one contract id. */
interface ServedContract {
  readonly id: ContributionId
  readonly version: number
  /** The host's own token, passed to `checkComponentCompatibility` as the contract. */
  readonly token: AnyComponentContract
}

export function createComponentRegistry(options: ComponentRegistryOptions = {}): CockpitComponentRegistry {
  catalogOf(options.contracts ?? [])
  return {}
}

/** The catalog by contract id. Throws `ComponentError` for host misuse. */
function catalogOf(contracts: readonly AnyComponentContract[]): ReadonlyMap<ContributionId, ServedContract> {
  if (!Array.isArray(contracts)) {
    throw new ComponentError('invalid-input', 'options.contracts must be an array of component contracts')
  }
  const served = new Map<ContributionId, ServedContract>()
  for (const token of contracts) {
    const read = tokenOf(token)
    if (read === undefined) throw new ComponentError('invalid-id', INVALID_CONTRACT)
    const { id, version } = read
    if (!id.startsWith(CORE_PREFIX)) {
      throw new ComponentError('namespace-violation', `Served component contract "${id}" must be under "${CORE_PREFIX}"`)
    }
    const first = served.get(id)
    if (first !== undefined) {
      throw new ComponentError(
        'duplicate-registration',
        `Component contract "${id}" is served twice (@${first.version} and @${version}): one major per id`,
      )
    }
    served.set(id, { id, version, token })
  }
  return served
}

/**
 * The id and major of a well-formed contract token, or `undefined`. Never throws, whatever it is
 * given: `kind`, `id` and `version` are each read once, inside a `try`. The capability lists are
 * not read here.
 */
function tokenOf(contract: unknown): { readonly id: ContributionId; readonly version: number } | undefined {
  try {
    if (typeof contract !== 'object' || contract === null) return undefined
    const { kind, id, version } = contract as { kind?: unknown; id?: unknown; version?: unknown }
    if (kind !== 'component' || typeof id !== 'string' || !isValidContributionId(id)) return undefined
    return isVersion(version) ? { id, version } : undefined
  } catch {
    // A throwing getter or a Proxy trap: not a token.
    return undefined
  }
}

function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}
